// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {FeeSplitterV3} from "../src/FeeSplitterV3.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {EquityRouter} from "../src/EquityRouter.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView, PoolKey} from "../src/interfaces/IUniV4.sol";
import {MockERC20, MockLaunchAndBuy} from "./CampaignV3.t.sol";
import {MockPonsFactoryMut} from "./Review.t.sol";

interface IBal { function balanceOf(address) external view returns (uint256); }

/// "Holders of this token earn SpaceX": a backer of a launched campaign
/// claims their ETH fee share as tokenized equity, against the live v4
/// pools, with the campaign side mocked (pons is not what's under test).
contract ForkClaimBackerAsTest is Test {
    IPoolManagerMin constant PM = IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address constant PLATFORM = address(0xFEE);

    CampaignFactoryV5 cf; EquityRouter router; MockPonsFactoryMut ponsF; MockLaunchAndBuy lab;
    address creator = address(0xC0FFEE); address alice = address(0xA11CE); address bob = address(0xB0B);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        vm.createSelectFork("rhc");
        router = new EquityRouter(PM);
        ponsF = new MockPonsFactoryMut(); lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV5(
            PLATFORM, address(0x4EAA), 700, 300,
            IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
            PM, address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV3(), FEE, IERC20(address(0)), 0, address(router)
        );
        vm.deal(creator, 5 ether); vm.deal(alice, 5 ether); vm.deal(bob, 5 ether);
    }

    function _launched() internal returns (CampaignV3 c, FeeSplitterV3 s) {
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.25 ether; p.deadline = block.timestamp + 1 days;
        p.payoutAsset = SPCX; // creator's default — the story on the poster
        p.meta = PonsTokenMeta("EQ", "EQ", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        vm.prank(creator);
        c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(9)));
        vm.prank(alice); c.deposit{value: 0.75 ether}();
        vm.prank(bob);   c.deposit{value: 0.25 ether}();
        vm.prank(creator); c.launch();
        s = FeeSplitterV3(payable(address(c.feeSplitter())));
        assertEq(address(s.equityRouter()), address(router), "router not threaded to splitter");
        assertEq(c.payoutAsset(), SPCX);
        // creator fees arrive as ETH (what pons pays a native pool)
        (bool ok, ) = address(s).call{value: 0.4 ether}(""); require(ok);
        s.distribute(address(0));
    }

    function _msft() internal pure returns (PoolKey memory) { return PoolKey(address(0), MSFT, 10000, 200, address(0)); }
    function _spcx() internal pure returns (PoolKey memory) { return PoolKey(address(0), SPCX, 3000, 30, address(0)); }

    function test_backerClaimsFeesAsStock_andPoolStaysSolvent() public {
        (, FeeSplitterV3 s) = _launched();
        uint256 owed = s.backerEntitlement(alice, address(0));
        assertEq(owed, 0.4 ether * 9000 / 10000 * 75 / 100, "alice's 75% of the 90% backer pool");
        vm.prank(alice);
        uint256 out = s.claimBackerAs(_msft(), 0);
        assertGt(out, 0); assertEq(IBal(MSFT).balanceOf(alice), out, "MSFT not delivered to alice");
        assertEq(address(s).balance, s.accounted(address(0)), "splitter accounting broke");
        assertEq(IBal(MSFT).balanceOf(address(s)), 0, "splitter custodied stock");
        vm.prank(alice); vm.expectRevert(FeeSplitter.NothingToClaim.selector);
        s.claimBackerAs(_msft(), 0); // nothing double-paid
    }

    function test_twoBackersDifferentAssets_andPlainEthStillWorks() public {
        (, FeeSplitterV3 s) = _launched();
        vm.prank(alice); uint256 a = s.claimBackerAs(_msft(), 0);
        uint256 bobBefore = bob.balance;
        vm.prank(bob); s.claimBacker(address(0)); // bob just wants ETH
        assertGt(a, 0); assertEq(IBal(MSFT).balanceOf(alice), a);
        assertEq(bob.balance - bobBefore, 0.4 ether * 9000 / 10000 * 25 / 100);
        assertEq(address(s).balance, s.accounted(address(0)));
    }

    function test_legClaimsAsStock_platformTakesSPCX() public {
        (, FeeSplitterV3 s) = _launched();
        uint256 legOwed = s.legOwed(PLATFORM, address(0));
        assertEq(legOwed, 0.4 ether * 700 / 10000);
        vm.prank(PLATFORM);
        uint256 out = s.claimLegAs(_spcx(), 0);
        assertGt(out, 0); assertEq(IBal(SPCX).balanceOf(PLATFORM), out);
        assertEq(s.legOwed(PLATFORM, address(0)), 0);
        assertEq(address(s).balance, s.accounted(address(0)));
    }

    function test_slippageRevert_leavesClaimIntact() public {
        (, FeeSplitterV3 s) = _launched();
        uint256 owed = s.backerEntitlement(alice, address(0));
        vm.prank(alice); vm.expectRevert();
        s.claimBackerAs(_msft(), 1_000_000e18);
        assertEq(s.backerEntitlement(alice, address(0)) - s.backerClaimed(alice, address(0)), owed, "claim consumed by a failed swap");
        vm.prank(alice); s.claimBacker(address(0)); // and the ETH path still pays
    }

    function test_noRouter_revertsCleanly() public {
        CampaignFactoryV5 bare = new CampaignFactoryV5(
            PLATFORM, address(0x4EAA), 700, 300, IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
            PM, address(0xB1), IV4StateView(address(0xB2)), new LegDeployerV3(), FEE, IERC20(address(0)), 0, address(0));
        CampaignParams memory p; p.goal = 0.1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("N", "N", "", "t", PonsSocials("", "", "", "", ""), address(0)); p.allowlist = new address[](0);
        vm.prank(creator); CampaignV3 c = bare.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(3)));
        vm.prank(alice); c.deposit{value: 0.1 ether}(); vm.prank(creator); c.launch();
        FeeSplitterV3 s = FeeSplitterV3(payable(address(c.feeSplitter())));
        (bool ok, ) = address(s).call{value: 0.1 ether}(""); require(ok);
        vm.prank(alice); vm.expectRevert(FeeSplitterV3.NoRouter.selector);
        s.claimBackerAs(_msft(), 0);
    }
}
