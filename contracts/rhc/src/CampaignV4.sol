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
    /// Team seats may take more than public ones (0 = same cap as the
    /// public, i.e. maxDeposit). Creator-set before launch, immutable
    /// after. Shown on the page; a backer who dislikes it withdraws.
    uint256 public teamMaxDeposit;

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
    /// visible on the roster before anyone else commits. Measured in days
    /// FROM LAUNCH, so "one year" means one year of the token existing,
    /// not one year minus however long the raise took. The tokens never
    /// leave THIS contract until the date: no second contract, no locker
    /// brand to trust, nothing an admin could shorten (there is no admin).
    /// Only ever extendable, and only before launch: the lock and its fee
    /// weight are both frozen the moment the token exists. Cleared by a
    /// pre-launch withdraw (they left).
    ///
    /// Locking PAYS: a locked seat's fee share is weighted (see
    /// lockMultiplierBps) — the extra comes out of the same pool the
    /// sellers forfeit. Token allocation is NOT weighted; only fees are.
    mapping(address => uint32) public lockDays;
    /// Fat-finger guard: a typo must not become a permanent lock.
    uint32 public constant MAX_LOCK_DAYS = 4 * 365;
    uint64 public launchedAt;
    /// Σ contribution × lockMultiplierBps / 10_000, kept live pre-launch and
    /// frozen at launch — the denominator of every fee claim.
    uint256 public weightedRaised;
    uint256 public weightedRaisedAtLaunch;
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
    event MetaUpdated(string name, string symbol, string logo);
    event TeamMaxDepositSet(uint256 teamMaxDeposit);
    event Locked(address indexed backer, uint32 lockDays, uint16 multiplierBps);

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
    /// The fee-weight tiers. Three thresholds, no admin, no curve to argue
    /// about: 0–179 days ×1.0 · 180–364 days ×1.25 · 365 days+ ×1.5.
    function lockMultiplierBps(uint32 days_) public pure returns (uint16) {
        if (days_ >= 365) return 15_000;
        if (days_ >= 180) return 12_500;
        return 10_000;
    }

    /// A backer's fee weight: contribution × multiplier. Read live by the
    /// splitter; both inputs are frozen from launch on.
    function backerWeight(address backer) external view returns (uint256) {
        return (contributionOf[backer] * lockMultiplierBps(lockDays[backer])) / 10_000;
    }

    /// When this backer's tokens become claimable. 0 = no lock or not
    /// launched yet (the roster shows lockDays before launch).
    function lockUntil(address backer) external view returns (uint64) {
        if (launchedAt == 0 || lockDays[backer] == 0) return 0;
        return launchedAt + uint64(lockDays[backer]) * 1 days;
    }

    /// deposit(), plus a promise: my tokens stay in this contract for
    /// `days_` days after launch. Set at seat time so every later backer
    /// can see it — and it pays (lockMultiplierBps).
    function depositLocked(uint32 days_) external payable nonReentrant {
        if (quoteToken != address(0)) revert WrongAsset();
        _setLock(days_);
        _deposit(msg.value);
    }

    /// depositToken(), locked. See depositLocked.
    function depositTokenLocked(uint256 amount, uint32 days_) external nonReentrant {
        if (quoteToken == address(0)) revert WrongAsset();
        _setLock(days_);
        if (!IERC20Quote(quoteToken).transferFrom(msg.sender, address(this), amount)) revert PayFailed();
        _deposit(amount);
    }

    /// Longer, never shorter — and only before launch, because the fee
    /// weight is frozen with the lock the moment the token exists.
    function extendLock(uint32 days_) external {
        if (contributionOf[msg.sender] == 0 || launched) revert BadState();
        _setLock(days_);
    }

    function _setLock(uint32 days_) internal {
        if (launched) revert BadState();
        uint32 cur = lockDays[msg.sender];
        if (days_ == 0 || days_ <= cur) revert LockNotLonger();
        if (days_ > MAX_LOCK_DAYS) revert LockTooLong();
        // re-weight the seat's existing contribution (a top-up follows in
        // _deposit at the new multiplier)
        uint256 c = contributionOf[msg.sender];
        if (c > 0) {
            weightedRaised = weightedRaised - (c * lockMultiplierBps(cur)) / 10_000 + (c * lockMultiplierBps(days_)) / 10_000;
        }
        lockDays[msg.sender] = days_;
        emit Locked(msg.sender, days_, lockMultiplierBps(days_));
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
        // team seats get their own ceiling once assigned (reserved bucket)
        uint256 cap = (seatBucket[msg.sender] == 2 || (contributionOf[msg.sender] == 0 && allowlisted[msg.sender] && maxBackers != 0 && reservedSeatsUsed < reservedSeats))
            && teamMaxDeposit != 0 ? teamMaxDeposit : maxDeposit;
        if (cap != 0 && newContribution > cap) revert BadAmount();

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
        weightedRaised += (amount * lockMultiplierBps(lockDays[msg.sender])) / 10_000;
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
        weightedRaised -= (amount * lockMultiplierBps(lockDays[msg.sender])) / 10_000;
        backerCount -= 1;
        if (seatBucket[msg.sender] == 2) reservedSeatsUsed -= 1;
        else if (seatBucket[msg.sender] == 1 && maxBackers != 0) publicSeatsUsed -= 1;
        seatBucket[msg.sender] = 0;
        lockDays[msg.sender] = 0; // the promise went with the seat
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
        weightedRaisedAtLaunch = weightedRaised;
        launchedAt = uint64(block.timestamp);

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
        if (lockDays[msg.sender] != 0 && block.timestamp < launchedAt + uint64(lockDays[msg.sender]) * 1 days) revert StillLocked();
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

    // ── pre-launch creator edits ─────────────────────────────────────
    // The SOL rule, on-chain: identity (name, symbol, logo) and the soft
    // fields are editable by the creator until launch, when they become
    // pons' immutable token meta. Never after. Any backer who dislikes an
    // edit can withdraw in full, so nothing here can trap anyone.

    function updateMeta(PonsTokenMeta calldata m) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (launched || cancelled) revert BadState();
        if (bytes(m.name).length == 0 || bytes(m.symbol).length == 0) revert BadAmount();
        meta = m;
        emit MetaUpdated(m.name, m.symbol, m.logo);
    }

    function setTeamMaxDeposit(uint256 cap) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (launched || cancelled) revert BadState();
        if (reservedSeats == 0) revert BadAmount();           // no team seats, no team cap
        if (cap != 0 && cap < minDeposit) revert BadAmount();
        teamMaxDeposit = cap;
        emit TeamMaxDepositSet(cap);
    }

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
