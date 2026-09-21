// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, PonsTokenMeta} from "./interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2FeeEscrow, IPonsV2Curve, PonsV2LaunchParams} from "./interfaces/IPonsV2.sol";
import {IEquityRouter} from "./interfaces/IEquityRouter.sol";
import {FeeSplitterV4} from "./FeeSplitterV4.sol";
import {ISplitterDeployerV4} from "./SplitterDeployerV4.sol";
import {CampaignParams} from "./CampaignV3.sol";

interface IERC20Quote {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// CampaignV3 with a FeeSplitterV4: the fee stream follows the tokens
/// (see FeeSplitterV4.sol). Everything else is CampaignV3 verbatim —
/// same params, same lifecycle, same constructor shape, so the CREATE2
/// grinder and the deployer encoding are unchanged. v8 factory only.
contract CampaignV4 {
    uint256 public constant GRACE = 3 days;

    // ── immutables ───────────────────────────────────────────────────
    address public immutable creator;
    IPonsV2Factory public immutable ponsFactory;
    IPonsV2LaunchAndBuy public immutable ponsLaunchAndBuy;
    uint256 public immutable goal;
    uint256 public immutable minDeposit;
    uint256 public immutable maxDeposit;
    uint256 public immutable maxBackers;
    uint256 public immutable deadline;
    uint256 public immutable launchConfigId;
    uint16 public immutable creatorTaxBps;
    bool public immutable buybackEnabled;
    address public immutable quoteToken;
    address public immutable payoutAsset; // UI default only — never enforced
    address public immutable gateToken;
    uint256 public immutable gateMinBalance;
    uint16 public immutable reservedSeats;
    FeeSplitterV4 public immutable feeSplitter;
    uint256 public immutable launchFeeEscrowed; // native ETH held for pons' launch fee (ERC20 quotes)

    PonsTokenMeta internal meta;

    // ── state ────────────────────────────────────────────────────────
    mapping(address => bool) public allowlisted;
    mapping(address => uint8) public seatBucket; // 0 none · 1 public · 2 reserved
    uint256 public publicSeatsUsed;
    uint256 public reservedSeatsUsed;

    mapping(address => uint256) public contributionOf;
    uint256 public totalRaised;
    uint256 public backerCount;
    bool public launched;
    bool public cancelled;
    bool public launchFeeRefunded;
    address public token;
    address public curve;
    uint256 public tokensAtLaunch;
    uint256 public excessAtLaunch;      // curve refund (quote units) on oversized raises
    uint256 public totalRaisedAtLaunch;
    mapping(address => bool) public tokensClaimed;
    /// Pre-launch lock, chosen by the backer when they take their seat and
    /// visible on the roster before anyone else commits. The tokens never
    /// leave THIS contract until the date: no second contract, no locker
    /// brand to trust, nothing an admin could shorten (there is no admin).
    /// Only ever extendable. Cleared by a pre-launch withdraw (they left).
    /// A locked seat still earns its full fee share — FeeSplitterV4 counts
    /// unclaimed tokens as held.
    mapping(address => uint64) public lockUntil;
    /// Fat-finger guard: a typo must not become a permanent lock.
    uint64 public constant MAX_LOCK = 4 * 365 days;
    /// Excess quote (oversized raise refund) is paid on claimTokens; a
    /// locked backer can take it early instead of waiting for their tokens.
    mapping(address => bool) public excessClaimed;

    event Deposited(address indexed backer, uint256 amount, uint256 totalRaised, uint8 bucket);
    event Withdrawn(address indexed backer, uint256 amount, uint256 totalRaised);
    event Launch(address indexed token, address curve, uint256 pooledBuy, uint256 tokensReceived, uint256 excessRefunded);
    event TokensClaimed(address indexed backer, uint256 tokenAmount, uint256 excessQuote);
    event Refunded(address indexed backer, uint256 amount);
    event LaunchFeeRefunded(address indexed creator, uint256 amount);
    event Cancelled();
    event Locked(address indexed backer, uint64 until);

    error BadState();
    error BadAmount();
    error SlotsFull();
    error PastDeadline();
    error NotLaunchable();
    error NotRefundable();
    error OnlyCreator();
    error PayFailed();
    error Reentrancy();
    error WrongAsset();
    error GateFailed();
    error StillLocked();
    error LockNotLonger();
    error LockTooLong();

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
        address equityRouter_,
        address splitterDeployer_,
        CampaignParams memory p,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_
    ) payable {
        if (p.goal == 0 || p.deadline <= block.timestamp) revert BadAmount();
        // A native raise below pons' launch fee can fill and then never
        // launch (pooled - fee underflows) — trapping backers until grace.
        if (p.quoteToken == address(0) && p.goal < ponsFactory_.launchFee()) revert BadAmount();
        // reserved seats only mean something in a slotted raise, and can't
        // exceed the seat count
        if (p.reservedSeats > 0 && (p.maxBackers == 0 || p.reservedSeats > p.maxBackers)) revert BadAmount();
        creator = creator_;
        ponsFactory = ponsFactory_;
        ponsLaunchAndBuy = ponsLaunchAndBuy_;
        goal = p.goal;
        minDeposit = p.minDeposit;
        maxDeposit = p.maxDeposit;
        maxBackers = p.maxBackers;
        deadline = p.deadline;
        launchConfigId = p.launchConfigId;
        creatorTaxBps = p.creatorTaxBps;
        buybackEnabled = p.buybackEnabled;
        quoteToken = p.quoteToken;
        payoutAsset = p.payoutAsset;
        gateToken = p.gateToken;
        gateMinBalance = p.gateMinBalance;
        reservedSeats = p.reservedSeats;
        // ERC20-quoted raises: the pons launch fee is native ETH, escrowed
        // here by the creator at creation (factory forwards it); refunded
        // to the creator if the raise never launches.
        launchFeeEscrowed = msg.value;
        for (uint256 i = 0; i < p.allowlist.length; i++) allowlisted[p.allowlist[i]] = true;
        // Forfeited backer shares go to the ProofBurner. The factory's leg
        // table is load-bearing here: the burner is ALWAYS legs[0]
        // (CampaignFactoryV6.previewLegs), platform always last.
        if (legRecipients_.length == 0) revert BadAmount();
        // Deployed through a satellite so the splitter's creation code does
        // not ride inside ours (EIP-170). msg.sender there is this address.
        feeSplitter = ISplitterDeployerV4(splitterDeployer_).deploy(
            IPonsV2FeeEscrow(ponsFeeEscrow_), backerBps_, legRecipients_, legBps_,
            IEquityRouter(equityRouter_), legRecipients_[0]
        );
        meta = p.meta;
    }

    receive() external payable {}

    // ── funding phase ────────────────────────────────────────────────

    /// Native-quoted deposits.
    function deposit() external payable nonReentrant {
        if (quoteToken != address(0)) revert WrongAsset();
        _deposit(msg.value);
    }

    /// ERC20-quoted deposits (approve first).
    /// deposit(), plus a promise: my tokens stay in this contract until
    /// `until`. Set at seat time so every later backer can see it.
    function depositLocked(uint64 until) external payable nonReentrant {
        if (quoteToken != address(0)) revert WrongAsset();
        _setLock(until);
        _deposit(msg.value);
    }

    /// depositToken(), locked. See depositLocked.
    function depositTokenLocked(uint256 amount, uint64 until) external nonReentrant {
        if (quoteToken == address(0)) revert WrongAsset();
        _setLock(until);
        if (!IERC20Quote(quoteToken).transferFrom(msg.sender, address(this), amount)) revert PayFailed();
        _deposit(amount);
    }

    /// Longer, never shorter. Any time before the tokens are claimed.
    function extendLock(uint64 until) external {
        if (contributionOf[msg.sender] == 0 || tokensClaimed[msg.sender]) revert BadState();
        _setLock(until);
    }

    function _setLock(uint64 until) internal {
        if (until <= block.timestamp || until <= lockUntil[msg.sender]) revert LockNotLonger();
        if (until > block.timestamp + MAX_LOCK) revert LockTooLong();
        lockUntil[msg.sender] = until;
        emit Locked(msg.sender, until);
    }

    function depositToken(uint256 amount) external nonReentrant {
        if (quoteToken == address(0)) revert WrongAsset();
        if (!IERC20Quote(quoteToken).transferFrom(msg.sender, address(this), amount)) revert PayFailed();
        _deposit(amount);
    }

    function _deposit(uint256 amount) internal {
        if (launched || cancelled) revert BadState();
        if (block.timestamp >= deadline) revert PastDeadline();
        uint256 newContribution = contributionOf[msg.sender] + amount;
        if (amount == 0 || newContribution < minDeposit) revert BadAmount();
        if (maxDeposit != 0 && newContribution > maxDeposit) revert BadAmount();

        if (contributionOf[msg.sender] == 0) {
            // token gate applies at entry
            if (gateToken != address(0) && IERC20(gateToken).balanceOf(msg.sender) < gateMinBalance) {
                revert GateFailed();
            }
            // seat assignment: allowlisted wallets fill reserved seats
            // first, everyone else competes for the public ones — and the
            // public's share is a guarantee, not a leftover
            if (maxBackers != 0) {
                if (allowlisted[msg.sender] && reservedSeatsUsed < reservedSeats) {
                    reservedSeatsUsed += 1;
                    seatBucket[msg.sender] = 2;
                } else {
                    if (publicSeatsUsed >= maxBackers - reservedSeats) revert SlotsFull();
                    publicSeatsUsed += 1;
                    seatBucket[msg.sender] = 1;
                }
            } else {
                seatBucket[msg.sender] = 1;
            }
            backerCount += 1;
        }
        contributionOf[msg.sender] = newContribution;
        totalRaised += amount;
        emit Deposited(msg.sender, amount, totalRaised, seatBucket[msg.sender]);
    }

    /// Full-exit withdrawal, any time before launch. Frees the seat back
    /// to its bucket.
    function withdraw() external nonReentrant {
        if (launched) revert BadState();
        uint256 amount = contributionOf[msg.sender];
        if (amount == 0) revert BadAmount();
        contributionOf[msg.sender] = 0;
        totalRaised -= amount;
        backerCount -= 1;
        if (seatBucket[msg.sender] == 2) reservedSeatsUsed -= 1;
        else if (seatBucket[msg.sender] == 1 && maxBackers != 0) publicSeatsUsed -= 1;
        seatBucket[msg.sender] = 0;
        lockUntil[msg.sender] = 0; // the promise went with the seat
        emit Withdrawn(msg.sender, amount, totalRaised);
        _payQuote(msg.sender, amount);
    }

    // ── launch ───────────────────────────────────────────────────────

    function launch() external nonReentrant {
        if (launched || cancelled) revert BadState();
        if (totalRaised < goal) revert NotLaunchable();
        if (msg.sender != creator && block.timestamp < deadline) revert NotLaunchable();
        if (block.timestamp > deadline + GRACE) revert NotLaunchable();

        launched = true;
        totalRaisedAtLaunch = totalRaised;

        uint256 fee = ponsFactory.launchFee();
        bytes32 econ = ponsFactory.previewLaunchEconomics(launchConfigId, quoteToken);

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

        address t;
        address c;
        if (quoteToken == address(0)) {
            uint256 pooled = address(this).balance;
            if (pooled <= fee) revert NotLaunchable(); // pons raised its fee past the pool: grace → refunds
            (t, c, ) = ponsLaunchAndBuy.launchAndBuy{value: pooled}(
                p, launchConfigId, address(0), pooled - fee, 0, address(this), new address[](0)
            );
            token = t;
            curve = c;
            excessAtLaunch = address(this).balance;
        } else {
            uint256 pooled = IERC20Quote(quoteToken).balanceOf(address(this));
            if (launchFeeEscrowed < fee) revert NotLaunchable(); // pons raised its fee: grace → refunds
            IERC20Quote(quoteToken).approve(address(ponsLaunchAndBuy), pooled);
            (t, c, ) = ponsLaunchAndBuy.launchAndBuy{value: fee}(
                p, launchConfigId, quoteToken, pooled, 0, address(this), new address[](0)
            );
            token = t;
            curve = c;
            IERC20Quote(quoteToken).approve(address(ponsLaunchAndBuy), 0);
            excessAtLaunch = IERC20Quote(quoteToken).balanceOf(address(this));
            // The escrow was sized at creation; pons' fee may have dropped
            // since. Whatever native is left is the creator's, and nothing
            // else in an ERC20 raise ever legitimately holds ETH here.
            _returnNativeToCreator();
        }
        tokensAtLaunch = IERC20(t).balanceOf(address(this));
        emit Launch(t, c, totalRaisedAtLaunch, tokensAtLaunch, excessAtLaunch);
    }

    // ── post-launch ──────────────────────────────────────────────────

    function claimTokens() external nonReentrant {
        if (!launched) revert BadState();
        if (tokensClaimed[msg.sender]) revert BadAmount();
        if (block.timestamp < lockUntil[msg.sender]) revert StillLocked();
        uint256 contribution = contributionOf[msg.sender];
        if (contribution == 0) revert BadAmount();
        tokensClaimed[msg.sender] = true;
        uint256 share = (tokensAtLaunch * contribution) / totalRaisedAtLaunch;
        uint256 excess = excessClaimed[msg.sender] ? 0 : (excessAtLaunch * contribution) / totalRaisedAtLaunch;
        excessClaimed[msg.sender] = true;
        emit TokensClaimed(msg.sender, share, excess);
        if (!IERC20(token).transfer(msg.sender, share)) revert PayFailed();
        if (excess > 0) _payQuote(msg.sender, excess);
    }

    /// The oversized-raise refund, on its own — so a lock never traps
    /// quote that was always going back to the backer.
    function claimExcess() external nonReentrant {
        if (!launched) revert BadState();
        if (excessClaimed[msg.sender]) revert BadAmount();
        uint256 contribution = contributionOf[msg.sender];
        if (contribution == 0) revert BadAmount();
        excessClaimed[msg.sender] = true;
        uint256 excess = (excessAtLaunch * contribution) / totalRaisedAtLaunch;
        if (excess == 0) revert BadAmount();
        _payQuote(msg.sender, excess);
    }

    /// Permissionless fee crank (sweep is pons-operator-gated; harvest
    /// is always ours to run).
    function pokeHarvest() external {
        address c = curve;
        if (c != address(0)) {
            try IPonsV2Curve(c).sweepFees(0) {} catch {}
        }
        feeSplitter.harvest();
    }

    // ── failure paths ────────────────────────────────────────────────

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
        _payQuote(msg.sender, amount);
    }

    /// ERC20-quoted raises only: return the creator's native escrow when
    /// the raise is dead, and sweep any native left after launch (fee
    /// surplus, stray sends). Never callable while a raise is live — the
    /// escrow is what launch spends. Native-quoted raises hold backers'
    /// ETH and revert here unconditionally.
    function refundLaunchFee() external nonReentrant {
        if (quoteToken == address(0)) revert NotRefundable();
        if (!launched && !refundable()) revert NotRefundable();
        if (address(this).balance == 0) revert NotRefundable();
        _returnNativeToCreator();
    }

    function _returnNativeToCreator() internal {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        launchFeeRefunded = true;
        emit LaunchFeeRefunded(creator, amount);
        (bool ok, ) = creator.call{value: amount}("");
        if (!ok) revert PayFailed();
    }

    // ── views + internals ────────────────────────────────────────────

    function tokenMeta() external view returns (PonsTokenMeta memory) {
        return meta;
    }

    function _payQuote(address to, uint256 amount) internal {
        if (quoteToken == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert PayFailed();
        } else {
            if (!IERC20Quote(quoteToken).transfer(to, amount)) revert PayFailed();
        }
    }
}
