// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPonsFactory, IPonsLocker, IERC20, PonsTokenMeta} from "./interfaces/IPons.sol";
import {FeeSplitter} from "./FeeSplitter.sol";

/// One community-pooled token launch on pons (Robinhood Chain).
///
/// The contract IS the token's creator: backers deposit ETH; once the goal is
/// met the pooled balance becomes the creator's initial buy — which pons
/// executes on the launch block, snipe-exempt by the launchpad's own rules —
/// and tokens land here for pro-rata pull-claims. Creator fees route to an
/// immutable FeeSplitter from birth.
///
/// Design rules (the money-audit constitution):
///   - The platform NEVER holds funds. No owner, no admin, no pause, no
///     upgrade. The only privileged address is `creator`, whose only powers
///     are launching EARLY (before deadline) and cancelling an unfunded raise.
///   - Every post-launch action (launch after deadline, claims, refunds,
///     fee collection, fee distribution) is a permissionless crank — nothing
///     depends on prooflaunch infrastructure being alive.
///   - Funds can never be stranded: if the launch hasn't happened by
///     deadline + GRACE, refunds open unconditionally.
///
/// Lifecycle:
///   Open --(goal met, creator early OR anyone after deadline)--> Launched
///   Open --(deadline passed, goal unmet)---------------------> refunds
///   Open --(deadline + GRACE passed, not launched)-----------> refunds
///   Open --(creator cancel before any launch)----------------> refunds
contract Campaign {
    uint256 public constant GRACE = 3 days;

    // ── immutable campaign parameters ────────────────────────────────
    address public immutable creator;
    IPonsFactory public immutable factory;
    uint256 public immutable goal;          // wei; launchable at/above this
    uint256 public immutable minDeposit;    // per backer
    uint256 public immutable maxDeposit;    // per backer (0 = uncapped)
    uint256 public immutable maxBackers;    // slots (0 = uncapped)
    uint256 public immutable deadline;      // unix ts
    uint256 public immutable launchConfigId;
    uint256 public immutable dexId;
    FeeSplitter public immutable feeSplitter;

    // ── token metadata (fixed at creation — what backers signed up for) ─
    PonsTokenMeta internal meta;

    // ── state ────────────────────────────────────────────────────────
    mapping(address => uint256) public contributionOf;
    uint256 public totalRaised;
    uint256 public backerCount;
    bool public launched;
    bool public cancelled;
    address public token;
    address public locker;
    uint256 public tokensAtLaunch;      // claimable pool snapshot
    uint256 public totalRaisedAtLaunch; // share denominator, frozen at launch
    mapping(address => bool) public tokensClaimed;

    // ── events (the indexer's source of truth) ───────────────────────
    event Deposited(address indexed backer, uint256 amount, uint256 totalRaised);
    event Withdrawn(address indexed backer, uint256 amount, uint256 totalRaised);
    event Launch(address indexed token, uint256 pooledBuy, uint256 tokensReceived);
    event TokensClaimed(address indexed backer, uint256 amount);
    event Refunded(address indexed backer, uint256 amount);
    event Cancelled();

    error BadState();
    error BadAmount();
    error SlotsFull();
    error PastDeadline();
    error NotLaunchable();
    error NotRefundable();
    error OnlyCreator();
    error EthSend();
    error Reentrancy();

    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address creator_,
        IPonsFactory factory_,
        uint256 goal_,
        uint256 minDeposit_,
        uint256 maxDeposit_,
        uint256 maxBackers_,
        uint256 deadline_,
        uint256 launchConfigId_,
        uint256 dexId_,
        PonsTokenMeta memory meta_,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_
    ) {
        if (goal_ == 0 || deadline_ <= block.timestamp) revert BadAmount();
        creator = creator_;
        factory = factory_;
        goal = goal_;
        minDeposit = minDeposit_;
        maxDeposit = maxDeposit_;
        maxBackers = maxBackers_;
        deadline = deadline_;
        launchConfigId = launchConfigId_;
        dexId = dexId_;
        feeSplitter = new FeeSplitter(address(this), backerBps_, legRecipients_, legBps_);
        meta = meta_;
        // fee routing is decided here, once, forever
        meta.feeWallet = address(feeSplitter);
    }

    // ── funding phase ────────────────────────────────────────────────

    function deposit() external payable nonReentrant {
        if (launched || cancelled) revert BadState();
        if (block.timestamp >= deadline) revert PastDeadline();
        uint256 newContribution = contributionOf[msg.sender] + msg.value;
        if (msg.value == 0 || newContribution < minDeposit) revert BadAmount();
        if (maxDeposit != 0 && newContribution > maxDeposit) revert BadAmount();
        if (contributionOf[msg.sender] == 0) {
            if (maxBackers != 0 && backerCount >= maxBackers) revert SlotsFull();
            backerCount += 1;
        }
        contributionOf[msg.sender] = newContribution;
        totalRaised += msg.value;
        emit Deposited(msg.sender, msg.value, totalRaised);
    }

    /// Your money is yours until the launch tx fires. Full-exit only —
    /// partial withdrawals reopen min-deposit gaming.
    function withdraw() external nonReentrant {
        if (launched) revert BadState();
        uint256 amount = contributionOf[msg.sender];
        if (amount == 0) revert BadAmount();
        contributionOf[msg.sender] = 0;
        totalRaised -= amount;
        backerCount -= 1;
        emit Withdrawn(msg.sender, amount, totalRaised);
        _send(msg.sender, amount);
    }

    // ── launch ───────────────────────────────────────────────────────

    /// Creator may launch any time once the goal is met. After the deadline,
    /// ANYONE may launch a goal-met campaign — a funded raise cannot be
    /// held hostage by an absent creator.
    function launch() external nonReentrant {
        if (launched || cancelled) revert BadState();
        if (totalRaised < goal) revert NotLaunchable();
        if (msg.sender != creator && block.timestamp < deadline) revert NotLaunchable();
        if (block.timestamp > deadline + GRACE) revert NotLaunchable(); // refunds own this window now

        launched = true;
        totalRaisedAtLaunch = totalRaised;
        locker = factory.locker();

        uint256 pooled = address(this).balance;
        address t = factory.launchToken{value: pooled}(
            meta,
            launchConfigId,
            dexId,
            bytes32(uint256(uint160(address(this))))
        );
        token = t;
        // pons delivers the initial-buy tokens to the feeWallet (the
        // splitter), not to the caller — sweep them home atomically. In this
        // same tx nothing else can have accrued to the splitter, so this is
        // exactly the launch allocation and never fee flow.
        feeSplitter.drainTo(address(this), t);
        tokensAtLaunch = IERC20(t).balanceOf(address(this));
        emit Launch(t, pooled, tokensAtLaunch);
    }

    // ── post-launch: pull claims + permissionless cranks ─────────────

    function claimTokens() external nonReentrant {
        if (!launched) revert BadState();
        if (tokensClaimed[msg.sender]) revert BadAmount();
        uint256 contribution = contributionOf[msg.sender];
        if (contribution == 0) revert BadAmount();
        tokensClaimed[msg.sender] = true;
        uint256 share = (tokensAtLaunch * contribution) / totalRaisedAtLaunch;
        emit TokensClaimed(msg.sender, share);
        if (!IERC20(token).transfer(msg.sender, share)) revert EthSend();
    }

    /// The locker's collectFees is deployer-gated; this contract is the
    /// deployer. Wrapping it keeps fee collection permissionless.
    function pokeCollect() external {
        IPonsLocker(locker).collectFees(token);
    }

    // ── failure paths — funds can never be stranded ──────────────────

    /// Creator may cancel an un-launched raise early (opens refunds).
    function cancel() external {
        if (msg.sender != creator) revert OnlyCreator();
        if (launched || cancelled) revert BadState();
        cancelled = true;
        emit Cancelled();
    }

    /// Refundable when: cancelled; or deadline passed with goal unmet; or
    /// deadline + GRACE passed without a launch (unconditional escape hatch).
    function refundable() public view returns (bool) {
        if (launched) return false;
        if (cancelled) return true;
        if (block.timestamp >= deadline && totalRaised < goal) return true;
        if (block.timestamp > deadline + GRACE) return true;
        return false;
    }

    function refund() external nonReentrant {
        if (!refundable()) revert NotRefundable();
        uint256 amount = contributionOf[msg.sender];
        if (amount == 0) revert BadAmount();
        contributionOf[msg.sender] = 0;
        totalRaised -= amount;
        emit Refunded(msg.sender, amount);
        _send(msg.sender, amount);
    }

    // ── views ────────────────────────────────────────────────────────

    function tokenMeta() external view returns (PonsTokenMeta memory) {
        return meta;
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthSend();
    }
}
