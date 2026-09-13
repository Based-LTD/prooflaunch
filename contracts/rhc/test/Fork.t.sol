// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {IPonsFactory, IPonsLocker, IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IUniV3FactoryMin} from "../src/BurnLeg.sol";

/// Fork tests against the LIVE pons factory on Robinhood Chain.
/// Run with:  forge test --match-contract Fork -vv
/// (skipped automatically when the RPC is unreachable)
contract ForkTest is Test {
    // Live pair as of 2026-09-07 — pons rotates factories; if these go
    // stale, rediscover via TokenLaunched topic scan (spec §8).
    address constant PONS_FACTORY = 0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    CampaignFactory cf;
    Campaign c;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        try vm.createSelectFork(RPC) {} catch {
            vm.skip(true);
            return;
        }
        cf = new CampaignFactory(address(0xFEE), address(0x4EAA), 500, 500, 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73, IUniV3FactoryMin(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA), 10000);
        PonsTokenMeta memory meta = PonsTokenMeta(
            "PoolLaunch Fork Probe", "PLFP", "", "fork test - never mainnet",
            PonsSocials("", "", "", "", ""), address(0)
        );
        vm.prank(creator);
        c = cf.createCampaign(
            IPonsFactory(PONS_FACTORY),
            1 ether, 0.1 ether, 2 ether, 24,
            block.timestamp + 1 days,
            0, 0, meta,
            0, new address[](0), new uint16[](0)
        );
        vm.deal(alice, 5 ether);
        vm.deal(bob, 5 ether);
    }

    function test_fork_endToEnd_launchOnRealPons() public {
        assertTrue(IPonsFactory(PONS_FACTORY).launchEnabled(), "factory disabled - rediscover live factory");

        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(bob);   c.deposit{value: 0.5 ether}();

        vm.prank(creator);
        c.launch();

        // token exists and the pooled initial buy delivered tokens to us
        address token = c.token();
        assertGt(token.code.length, 0, "token not deployed");
        uint256 pool = c.tokensAtLaunch();
        assertGt(pool, 0, "initial buy returned no tokens");

        // fee routing: the live locker RECORDS the launch feeWallet as the
        // redirect (fork discovery — older docs said zero-until-redirected).
        // Either way the resolved recipient must be OUR splitter and nothing
        // else, ever.
        IPonsLocker locker = IPonsLocker(c.locker());
        address redirect = locker.feeRedirects(token);
        assertTrue(
            redirect == address(0) || redirect == address(c.feeSplitter()),
            "fee recipient is not our splitter"
        );

        // pro-rata claims work against the real token
        vm.prank(alice); c.claimTokens();
        vm.prank(bob);   c.claimTokens();
        assertEq(IERC20(token).balanceOf(alice), pool * 2 / 3);

        // pokeCollect passes the locker's AUTH gate as deployer.
        // Zero fees accrued yet, so accept either a clean no-op or the
        // "nothing to collect" revert — but never the unauthorized error.
        try c.pokeCollect() {
            // fine: collected nothing
        } catch (bytes memory reason) {
            bytes4 sel = bytes4(reason);
            assertTrue(sel != 0xea8e4eb5, "locker treated deployer as UNAUTHORIZED");
        }
    }

    function test_fork_predictTokenAddress() public view {
        // deterministic pre-launch address exists for UX (show CA before launch)
        PonsTokenMeta memory meta = c.tokenMeta();
        address predicted = IPonsFactory(PONS_FACTORY).predictTokenAddress(
            meta, 0, 0, bytes32(uint256(uint160(address(c)))), address(c)
        );
        assertTrue(predicted != address(0));
    }
}
