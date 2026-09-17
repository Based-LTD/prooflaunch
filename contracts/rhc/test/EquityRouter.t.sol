// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EquityRouter} from "../src/EquityRouter.sol";
import {IPoolManagerMin, PoolKey} from "../src/interfaces/IUniV4.sol";

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
    function symbol() external view returns (string memory);
}

/// Live-fork proof that "get paid in stock" actually pays in stock.
/// Pool keys come from tools/_rwa-poolkeys.mjs (see contracts/rhc/RWA_POOLS.md),
/// read off real v4 Initialize events — no mocks, no assumed fee tiers.
contract EquityRouterTest is Test {
    IPoolManagerMin constant PM = IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address constant LLY  = 0x8005d266423c7ea827372c9c864491e5786600ea;

    EquityRouter router;
    address claimer = address(0xC1A1);

    function setUp() public {
        vm.createSelectFork("rhc");
        router = new EquityRouter(PM);
    }

    // Deepest ETH-paired pool per asset, measured 2026-09-16.
    function _key(address asset) internal pure returns (PoolKey memory) {
        if (asset == MSFT) return PoolKey(address(0), MSFT, 10000, 200, address(0));
        if (asset == SPCX) return PoolKey(address(0), SPCX, 3000, 30, address(0));
        if (asset == META) return PoolKey(address(0), META, 48000, 480, address(0));
        return PoolKey(address(0), LLY, 50000, 200, address(0));
    }

    function _route(address asset, uint256 ethIn, uint256 minOut) internal returns (uint256) {
        vm.deal(address(this), ethIn);
        return router.routeEthTo{value: ethIn}(_key(asset), minOut, claimer, "");
    }

    /// The headline: ETH goes in, real tokenized equity lands in the
    /// claimer's wallet — and the router keeps nothing.
    function test_routesEthToEquity() public {
        uint256 before = IERC20Bal(MSFT).balanceOf(claimer);
        uint256 out = _route(MSFT, 0.2 ether, 0);

        assertGt(out, 0, "no MSFT out");
        assertEq(IERC20Bal(MSFT).balanceOf(claimer) - before, out, "claimer not credited");
        assertEq(address(router).balance, 0, "router kept ETH");
        assertEq(IERC20Bal(MSFT).balanceOf(address(router)), 0, "router kept asset");

        // ~0.204 ETH per MSFT => 0.2 ETH should buy on the order of 1 share,
        // less the pool's 1% fee. Bound loosely; this asserts sanity, not price.
        emit log_named_uint("MSFT out (wei)", out);
        assertGt(out, 0.5e18, "implausibly little MSFT");
        assertLt(out, 2e18, "implausibly much MSFT");
    }

    /// Every asset a creator could realistically name must work, at the
    /// real fee tier each pool actually uses.
    function test_everyLiquidEquityRoutes() public {
        address[4] memory assets = [MSFT, SPCX, META, LLY];
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 out = _route(assets[i], 0.05 ether, 0);
            emit log_named_uint(IERC20Bal(assets[i]).symbol(), out);
            assertGt(out, 0, "asset did not route");
            assertEq(address(router).balance, 0, "router kept ETH");
        }
    }

    /// The claimer's own slippage bound is the protection, and it must bite.
    function test_minOutReverts() public {
        vm.deal(address(this), 0.05 ether);
        uint256 absurd = 1_000_000e18;
        vm.expectRevert();
        router.routeEthTo{value: 0.05 ether}(_key(MSFT), absurd, claimer, "");
    }

    /// A non-native currency0 would break the msg.value accounting entirely.
    function test_rejectsNonNativePair() public {
        vm.deal(address(this), 1 ether);
        PoolKey memory bad = PoolKey(MSFT, SPCX, 3000, 30, address(0));
        vm.expectRevert(EquityRouter.NotNativePair.selector);
        router.routeEthTo{value: 1 ether}(bad, 0, claimer, "");
    }

    function test_rejectsZeroValueAndBadRecipient() public {
        vm.expectRevert(EquityRouter.NothingIn.selector);
        router.routeEthTo{value: 0}(_key(MSFT), 0, claimer, "");

        vm.deal(address(this), 1 ether);
        vm.expectRevert(EquityRouter.BadRecipient.selector);
        router.routeEthTo{value: 0.01 ether}(_key(MSFT), 0, address(0), "");
    }

    /// The callback is the only place funds move; it must be unreachable
    /// except from the PoolManager mid-unlock.
    function test_callbackNotCallableDirectly() public {
        vm.expectRevert(EquityRouter.BadCallback.selector);
        router.unlockCallback("");

        vm.prank(address(PM));
        vm.expectRevert(EquityRouter.BadCallback.selector);
        router.unlockCallback("");
    }

    /// Two claims in a row must behave identically — no residue carried
    /// between calls that could strand or misdirect the second one.
    function test_backToBackClaimsAreClean() public {
        uint256 a = _route(SPCX, 0.05 ether, 0);
        uint256 b = _route(SPCX, 0.05 ether, 0);
        assertGt(a, 0);
        assertGt(b, 0);
        assertEq(address(router).balance, 0, "router kept ETH between claims");
        assertEq(IERC20Bal(SPCX).balanceOf(claimer), a + b, "claims did not accumulate");
    }
}
