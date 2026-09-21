// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4LegBase, ICampaignV2View, IFeeSplitterLegV2, IPonsV2FactoryLegView, IPonsV2CurveLeg} from "./V4LegBase.sol";
import {IPoolManagerMin, PoolKey, V4SwapParams, V4Delta} from "./interfaces/IUniV4.sol";
import {IERC20} from "./interfaces/IPons.sol";

interface ISplitterCampaignView {
    function campaign() external view returns (address);
}

/// The platform flywheel: every ProofLaunch campaign's fixed platform-burn
/// leg, every seller's forfeited fee share (FeeSplitterV4), and every
/// creation fee land here as ETH — and the only thing this contract can do
/// with ETH is buy the platform token and send it to the dead address.
///
///   volume on any ProofLaunch token → creator tax → that campaign's
///   splitter → pull() → crank() → PROOF bought and burned
///
/// It is BurnLegV3 with two differences: the target is fixed at
/// construction (the platform token's own campaign — so it can only be
/// deployed AFTER that token exists), and it collects from any number of
/// splitters instead of one. Same buy path, fork-proven: the pons curve
/// before graduation, the Uniswap v4 PoolManager directly after.
///
/// No owner, no operator, no off switch, no withdraw, no way to retarget.
/// Anyone may pull; anyone may crank; one crank per block with a per-crank
/// ETH cap, so the cap is a real per-block bound on sandwich extraction.
contract ProofBurner is V4LegBase {
    using V4Delta for int256;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_ETH_PER_CRANK = 0.2 ether;

    address public immutable proofToken;

    uint256 public totalEthPulled;    // ETH collected from campaign splitters via pull()
    uint256 public totalEthSpent;     // ETH turned into burned PROOF
    uint256 public totalTokensBurned; // PROOF sent to DEAD
    uint256 public lastCrankBlock;

    uint256 private _plock = 1;

    error CrankedThisBlock();
    error Reentrancy();

    event Pulled(address indexed splitter, uint256 ethAmount);
    event Burned(uint256 ethIn, uint256 tokensBurned, bool viaCurve);
    event ForeignBurned(address indexed token, uint256 amount);

    /// `initializer` is address(0): the base's one-time init() can never be
    /// called, and campaign/ponsFactory are fixed right here.
    constructor(
        ICampaignV2View proofCampaign_,
        IPonsV2FactoryLegView ponsFactory_,
        IPoolManagerMin poolManager_,
        address memeHook_
    ) V4LegBase(address(0), poolManager_, memeHook_) {
        if (!proofCampaign_.launched()) revert NotLaunched();
        campaign = proofCampaign_;
        ponsFactory = ponsFactory_;
        proofToken = proofCampaign_.token();
    }

    modifier nonReentrant() {
        if (_plock != 1) revert Reentrancy();
        _plock = 2;
        _;
        _plock = 1;
    }

    // ── collect ──────────────────────────────────────────────────────

    /// Pull this contract's ETH leg out of a campaign's splitter. The
    /// address is caller-supplied and may be anything: a raw call whose
    /// result is ignored, so a bogus or hostile target can only waste the
    /// caller's gas. Only ETH that actually arrives is counted.
    function pull(address splitter_) public nonReentrant {
        uint256 before = address(this).balance;
        (bool ok, ) = splitter_.call(abi.encodeWithSelector(IFeeSplitterLegV2.claimLeg.selector, address(0)));
        ok; // "nothing to claim" is a normal answer
        uint256 got = address(this).balance - before;
        if (got > 0) {
            totalEthPulled += got;
            emit Pulled(splitter_, got);
        }
    }

    function pullMany(address[] calldata splitters) external {
        for (uint256 i = 0; i < splitters.length; i++) pull(splitters[i]);
    }

    /// Token-side fees: a campaign's splitter can owe this leg some of that
    /// campaign's OWN token. There is nothing useful to do with it except
    /// what we do with everything else — burn it. (If it is PROOF itself,
    /// the next crank burns it.) ERC20 quote-asset legs are deliberately
    /// left unclaimed in their splitters: burning a stablecoin helps no one.
    function pullCampaignToken(address splitter_) external nonReentrant {
        address t = ICampaignV2View(ISplitterCampaignView(splitter_).campaign()).token();
        if (t == address(0)) return;
        (bool ok, ) = splitter_.call(abi.encodeWithSelector(IFeeSplitterLegV2.claimLeg.selector, t));
        ok;
        if (t == proofToken) return;
        uint256 bal = IERC20(t).balanceOf(address(this));
        if (bal > 0) {
            IERC20(t).transfer(DEAD, bal);
            emit ForeignBurned(t, bal);
        }
    }

    // ── burn ─────────────────────────────────────────────────────────

    /// Permissionless burn round: any PROOF held burns; up to the cap of
    /// ETH buys PROOF, which burns.
    function crank() external nonReentrant {
        if (lastCrankBlock == block.number) revert CrankedThisBlock();
        lastCrankBlock = block.number;
        address token = proofToken;
        uint256 burnedNow = 0;

        uint256 tb = IERC20(token).balanceOf(address(this));
        if (tb > 0) {
            IERC20(token).transfer(DEAD, tb);
            burnedNow += tb;
        }

        uint256 eb = address(this).balance;
        uint256 amt = eb > MAX_ETH_PER_CRANK ? MAX_ETH_PER_CRANK : eb;
        bool viaCurve = false;
        if (amt > 0) {
            IPonsV2CurveLeg curve = IPonsV2CurveLeg(campaign.curve());
            if (!curve.graduated()) {
                viaCurve = true;
                curve.buy{value: amt}(amt, 0, address(this));
            } else {
                _unlock(abi.encode(token, amt));
            }
            totalEthSpent += amt;
            uint256 bought = IERC20(token).balanceOf(address(this));
            if (bought > 0) {
                IERC20(token).transfer(DEAD, bought);
                burnedNow += bought;
            }
        }

        totalTokensBurned += burnedNow;
        emit Burned(amt, burnedNow, viaCurve);
    }

    /// ETH waiting to be burned — the ticker's "next up" number.
    function pendingEth() external view returns (uint256) {
        return address(this).balance;
    }

    function _handleUnlock(bytes calldata data) internal override returns (bytes memory) {
        (address token, uint256 ethIn) = abi.decode(data, (address, uint256));
        PoolKey memory k = _poolKey(token);
        int256 delta = poolManager.swap(
            k,
            V4SwapParams({zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_SQRT}),
            ""
        );
        _settleDelta(k, delta);
        return "";
    }
}
