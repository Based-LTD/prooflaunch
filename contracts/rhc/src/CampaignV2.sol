// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, PonsTokenMeta} from "./interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2FeeEscrow, IPonsV2Curve, PonsV2LaunchParams} from "./interfaces/IPonsV2.sol";
import {FeeSplitterV2} from "./FeeSplitterV2.sol";

/// One community-pooled token launch on pons V2 (curve → locked Uniswap v4).
/// Same money-audit constitution as V1's Campaign — the platform never holds
/// funds, no owner/admin/pause/upgrade, every post-launch action is a
/// permissionless crank, funds can never be stranded — plus the V2 features:
///
///   - creatorTaxBps: the pons trading tax, chosen at creation, immutable,
///     earned by the campaign's FeeSplitter (i.e. by the backers)
///   - buybackEnabled: pons' native buyback flywheel for this token
///   - the pooled buy goes through pons' LaunchAndBuy in ONE transaction:
///     token + curve created and bought before any external actor can act
///   - oversized raises: a pooled buy crossing the graduation threshold is
///     partially refunded BY THE CURVE to this contract; the refund is
///     snapshotted as excessAtLaunch and claimed pro-rata with tokens
contract CampaignV2 {
    uint256 public constant GRACE = 3 days;

    // ── immutable campaign parameters ────────────────────────────────
    address public immutable creator;
    IPonsV2Factory public immutable ponsFactory;
    IPonsV2LaunchAndBuy public immutable ponsLaunchAndBuy;
    uint256 public immutable goal;
    uint256 public immutable minDeposit;
    uint256 public immutable maxDeposit;    // 0 = uncapped
    uint256 public immutable maxBackers;    // 0 = uncapped
    uint256 public immutable deadline;
    uint256 public immutable launchConfigId;
    uint16 public immutable creatorTaxBps;
    bool public immutable buybackEnabled;
    FeeSplitterV2 public immutable feeSplitter;

    // ── token metadata (fixed at creation — what backers signed up for) ─
    PonsTokenMeta internal meta; // feeWallet field unused on V2

    // ── state ────────────────────────────────────────────────────────
    mapping(address => uint256) public contributionOf;
    uint256 public totalRaised;
    uint256 public backerCount;
    bool public launched;
    bool public cancelled;
    address public token;
    address public curve;
    uint256 public tokensAtLaunch;      // claimable pool snapshot
    uint256 public excessAtLaunch;      // curve refund on oversized raises
    uint256 public totalRaisedAtLaunch; // share denominator, frozen at launch
    mapping(address => bool) public tokensClaimed;

    event Deposited(address indexed backer, uint256 amount, uint256 totalRaised);
    event Withdrawn(address indexed backer, uint256 amount, uint256 totalRaised);
    event Launch(address indexed token, address curve, uint256 pooledBuy, uint256 tokensReceived, uint256 excessRefunded);
    event TokensClaimed(address indexed backer, uint256 tokenAmount, uint256 excessEth);
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
        IPonsV2Factory ponsFactory_,
        IPonsV2LaunchAndBuy ponsLaunchAndBuy_,
        address ponsFeeEscrow_,
        uint256 goal_,
        uint256 minDeposit_,
        uint256 maxDeposit_,
        uint256 maxBackers_,
        uint256 deadline_,
        uint256 launchConfigId_,
        uint16 creatorTaxBps_,
        bool buybackEnabled_,
        PonsTokenMeta memory meta_,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_
    ) {
        if (goal_ == 0 || deadline_ <= block.timestamp) revert BadAmount();
        creator = creator_;
        ponsFactory = ponsFactory_;
        ponsLaunchAndBuy = ponsLaunchAndBuy_;
        goal = goal_;
        minDeposit = minDeposit_;
        maxDeposit = maxDeposit_;
        maxBackers = maxBackers_;
        deadline = deadline_;
        launchConfigId = launchConfigId_;
        creatorTaxBps = creatorTaxBps_;
        buybackEnabled = buybackEnabled_;
        feeSplitter = new FeeSplitterV2(
            address(this),
            IPonsV2FeeEscrow(ponsFeeEscrow_),
            backerBps_,
            legRecipients_,
            legBps_
        );
        meta = meta_;
    }

    /// The curve refunds excess here on oversized raises; nothing else is
    /// expected, but stray donations only ever add to backer value.
    receive() external payable {}

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

    /// Your money is yours until the launch tx fires. Full-exit only.
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

    /// Creator may launch once the goal is met; anyone may after the
    /// deadline. One transaction: create token + curve, pooled buy lands
    /// here, fee routing to the splitter fixed forever.
    function launch() external nonReentrant {
        if (launched || cancelled) revert BadState();
        if (totalRaised < goal) revert NotLaunchable();
        if (msg.sender != creator && block.timestamp < deadline) revert NotLaunchable();
        if (block.timestamp > deadline + GRACE) revert NotLaunchable();

        launched = true;
        totalRaisedAtLaunch = totalRaised;

        uint256 pooled = address(this).balance;
        uint256 fee = ponsFactory.launchFee();
        // Read the economics hash in the SAME tx — pons refuses the launch
        // if the config changed between read and execution.
        bytes32 econ = ponsFactory.previewLaunchEconomics(launchConfigId, address(0));

        PonsTokenMeta memory m = meta;
        PonsV2LaunchParams memory p = PonsV2LaunchParams({
            name: m.name,
            symbol: m.symbol,
            logo: m.logo,
            description: m.description,
            socials: m.socials,
            creatorFeeRecipient: address(feeSplitter),
            creatorTaxBps: creatorTaxBps,
            buybackEnabled: buybackEnabled,
            expectedEconomics: econ,
            salt: bytes32(uint256(uint160(address(this))))
        });

        // minTokensOut = 0 is safe here: the curve is CREATED in this same
        // transaction — no one can trade it before our buy.
        (address t, address c, ) = ponsLaunchAndBuy.launchAndBuy{value: pooled}(
            p, launchConfigId, address(0), pooled - fee, 0, address(this), new address[](0)
        );
        token = t;
        curve = c;
        tokensAtLaunch = IERC20(t).balanceOf(address(this));
        // Oversized raise: the curve refunds whatever crossed graduation.
        excessAtLaunch = address(this).balance;
        emit Launch(t, c, pooled, tokensAtLaunch, excessAtLaunch);
    }

    // ── post-launch: pull claims + permissionless cranks ─────────────

    /// Claim your token share — and, on oversized raises, your share of the
    /// ETH the curve refunded at launch.
    function claimTokens() external nonReentrant {
        if (!launched) revert BadState();
        if (tokensClaimed[msg.sender]) revert BadAmount();
        uint256 contribution = contributionOf[msg.sender];
        if (contribution == 0) revert BadAmount();
        tokensClaimed[msg.sender] = true;
        uint256 share = (tokensAtLaunch * contribution) / totalRaisedAtLaunch;
        uint256 excess = (excessAtLaunch * contribution) / totalRaisedAtLaunch;
        emit TokensClaimed(msg.sender, share, excess);
        if (!IERC20(token).transfer(msg.sender, share)) revert EthSend();
        if (excess > 0) _send(msg.sender, excess);
    }

    /// Permissionless fee crank. pons V2 gates the curve→escrow sweep to
    /// its own feeSweepOperator bot (verified on fork: NotFeeSweepOperator)
    /// — the try lets us piggyback if pons ever opens it, and their bot
    /// sweeps continuously anyway since the pons protocol share rides the
    /// same sweep. Once fees hit the escrow, harvest() is fully
    /// permissionless: pull + account, nobody can block it.
    function pokeHarvest() external {
        address c = curve;
        if (c != address(0)) {
            try IPonsV2Curve(c).sweepFees(0) {} catch {}
        }
        feeSplitter.harvest();
    }

    // ── failure paths — funds can never be stranded ──────────────────

    function cancel() external {
        if (msg.sender != creator) revert OnlyCreator();
        if (launched || cancelled) revert BadState();
        cancelled = true;
        emit Cancelled();
    }

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
