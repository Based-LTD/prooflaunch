// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignV2} from "../src/CampaignV2.sol";
import {CampaignFactoryV2} from "../src/CampaignFactoryV2.sol";
import {FeeSplitterV2} from "../src/FeeSplitterV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2FeeEscrow, IPonsV2Curve} from "../src/interfaces/IPonsV2.sol";

/// Buys/sells on the live curve as an external trader (contract so we can
/// receive tokens + ETH).
interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPonsV2HookView {
    function feeSweepOperator() external view returns (address);
}

contract CurveTrader {
    receive() external payable {}
    function buy(address curve, uint256 quoteIn) external returns (uint256) {
        return IPonsV2Curve(curve).buy{value: quoteIn}(quoteIn, 0, address(this));
    }
    function sell(address curve, address token, uint256 amount) external returns (uint256) {
        IERC20Approve(token).approve(curve, amount);
        return IPonsV2Curve(curve).sell(amount, 0, address(this));
    }
}

/// Fork tests against LIVE pons V2 on Robinhood Chain — the generation with
/// the adjustable creator tax (curve → locked Uniswap v4).
/// Run with:  forge test --match-contract ForkV2 -vv
contract ForkV2Test is Test {
    // Live V2 deployment, recovered from the pons frontend + verified
    // on-chain 2026-09-14. pons rotates deployments; if stale, re-extract
    // from their app bundle (see DEPLOYMENTS.md notes).
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant PONS_V2_MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    CampaignFactoryV2 cf;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address platform = address(0xFEE);
    address rewards = address(0x4EAA);

    function setUp() public {
        try vm.createSelectFork(RPC) {} catch {
            vm.skip(true);
            return;
        }
        cf = new CampaignFactoryV2(
            platform, rewards, 700, 300,
            IPonsV2Factory(PONS_V2_FACTORY),
            IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY),
            PONS_V2_FEE_ESCROW
        );
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _meta() internal pure returns (PonsTokenMeta memory) {
        return PonsTokenMeta(
            "PoolLaunch V2 Probe", "PLV2", "", "fork test - never mainnet",
            PonsSocials("", "", "", "", ""), address(0)
        );
    }

    function _create(uint16 taxBps, bool buyback) internal returns (CampaignV2 c) {
        vm.prank(creator);
        c = cf.createCampaign(
            1 ether, 0.1 ether, 8 ether, 24,
            block.timestamp + 1 days,
            0, taxBps, buyback, _meta(),
            new address[](0), new uint16[](0)
        );
    }

    function test_forkv2_launchWithTax() public {
        assertTrue(IPonsV2Factory(PONS_V2_FACTORY).launchEnabled(), "V2 factory disabled - rediscover");
        assertGe(IPonsV2Factory(PONS_V2_FACTORY).maxCreatorTaxBps(), 500, "tax cap moved");

        CampaignV2 c = _create(500, false);
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(bob);   c.deposit{value: 0.5 ether}();

        vm.prank(creator);
        c.launch();

        address token = c.token();
        address curve = c.curve();
        assertGt(token.code.length, 0, "token not deployed");
        assertGt(curve.code.length, 0, "curve not deployed");
        assertGt(c.tokensAtLaunch(), 0, "no tokens from pooled buy");
        // the curve records our tax and the splitter as recipient
        assertEq(IPonsV2Curve(curve).creatorTaxBps(), 500, "tax not applied");

        // pro-rata claims: alice 2/3, bob 1/3
        uint256 pool = c.tokensAtLaunch();
        vm.prank(alice); c.claimTokens();
        vm.prank(bob);   c.claimTokens();
        assertApproxEqAbs(IERC20(token).balanceOf(alice), (pool * 2) / 3, 2);
        assertApproxEqAbs(IERC20(token).balanceOf(bob), pool / 3, 2);
    }

    function test_forkv2_taxCapEnforced() public {
        uint256 cap = IPonsV2Factory(PONS_V2_FACTORY).maxCreatorTaxBps();
        vm.prank(creator);
        vm.expectRevert(CampaignFactoryV2.TaxTooHigh.selector);
        cf.createCampaign(
            1 ether, 0.1 ether, 0, 0, block.timestamp + 1 days,
            0, uint16(cap + 1), false, _meta(),
            new address[](0), new uint16[](0)
        );
    }

    function test_forkv2_feeFlow_90_7_3() public {
        CampaignV2 c = _create(500, false);
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(creator); c.launch();

        address token = c.token();
        address curve = c.curve();
        FeeSplitterV2 splitter = c.feeSplitter();

        // Trade on the live curve as an outsider. The V2 snipe tax decays
        // over ~5 seconds — trade well past it.
        vm.warp(block.timestamp + 60);
        vm.roll(block.number + 30);
        CurveTrader trader = new CurveTrader();
        vm.deal(address(trader), 2 ether);
        trader.buy(curve, 0.3 ether);
        trader.sell(curve, token, IERC20(token).balanceOf(address(trader)) / 2);

        assertGt(IPonsV2Curve(curve).creatorTaxBalance(), 0, "no creator tax accrued on curve");

        // The curve→escrow sweep is gated to pons' feeSweepOperator (their
        // bot runs it continuously — the pons protocol share rides the same
        // sweep). Impersonate the real operator to model that step, then
        // prove OUR side — harvest and every claim — is permissionless.
        address sweeper = IPonsV2HookView(PONS_V2_MEME_HOOK).feeSweepOperator();
        vm.prank(sweeper);
        IPonsV2Curve(curve).sweepFees(0);
        assertGt(
            IPonsV2FeeEscrow(PONS_V2_FEE_ESCROW).balanceOf(address(splitter)), 0,
            "sweep did not credit the splitter in the escrow"
        );

        uint256 splitterEthBefore = address(splitter).balance;
        vm.prank(address(0xDEAD1)); // rando cranks
        c.pokeHarvest();
        uint256 arrived = address(splitter).balance - splitterEthBefore;
        assertGt(arrived, 0, "no ETH reached the splitter");

        // 90/7/3 on native ETH
        uint256 backerPool = splitter.backerPool(address(0));
        uint256 platformOwed = splitter.legOwed(platform, address(0));
        uint256 rewardsOwed = splitter.legOwed(rewards, address(0));
        uint256 total = backerPool + platformOwed + rewardsOwed;
        assertGt(total, 0, "nothing distributed");
        assertApproxEqAbs(backerPool, (total * 9000) / 10_000, 3, "backer share off");
        assertApproxEqAbs(rewardsOwed, (total * 300) / 10_000, 3, "rewards share off");

        // pulls actually pay
        uint256 aliceBefore = alice.balance;
        vm.prank(alice); splitter.claimBacker(address(0));
        assertEq(alice.balance - aliceBefore, backerPool, "sole backer should get the whole pool");
        uint256 platBefore = platform.balance;
        vm.prank(platform); splitter.claimLeg(address(0));
        assertEq(platform.balance - platBefore, platformOwed);
    }

    function test_forkv2_oversizedRaise_refundClaimable() public {
        // graduation is 4.2 ETH; pool 6 ETH crosses it — the curve refunds
        // the excess to the campaign, which owes it to backers pro-rata.
        CampaignV2 c = _create(0, false);
        vm.prank(alice); c.deposit{value: 4 ether}();
        vm.prank(bob);   c.deposit{value: 2 ether}();
        vm.prank(creator); c.launch();

        assertGt(c.tokensAtLaunch(), 0, "no tokens");
        uint256 excess = c.excessAtLaunch();
        assertGt(excess, 0, "expected a graduation refund on a 6 ETH buy");

        uint256 aliceEthBefore = alice.balance;
        vm.prank(alice); c.claimTokens();
        assertApproxEqAbs(alice.balance - aliceEthBefore, (excess * 4) / 6, 2, "excess share wrong");

        uint256 bobEthBefore = bob.balance;
        vm.prank(bob); c.claimTokens();
        assertApproxEqAbs(bob.balance - bobEthBefore, (excess * 2) / 6, 2);

        // nothing stranded beyond rounding dust
        assertLe(address(c).balance, 2, "ETH stranded in campaign");
    }

    function test_forkv2_withdraw_and_refund_paths() public {
        CampaignV2 c = _create(200, true);
        vm.prank(alice); c.deposit{value: 0.5 ether}();
        uint256 before = alice.balance;
        vm.prank(alice); c.withdraw();
        assertEq(alice.balance - before, 0.5 ether, "withdraw not full-amount");

        // goal unmet past deadline -> refunds
        vm.prank(bob); c.deposit{value: 0.2 ether}();
        vm.warp(c.deadline() + 1);
        assertTrue(c.refundable());
        uint256 bobBefore = bob.balance;
        vm.prank(bob); c.refund();
        assertEq(bob.balance - bobBefore, 0.2 ether);
    }
}
