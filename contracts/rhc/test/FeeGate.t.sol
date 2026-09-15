// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignFactoryV4} from "../src/CampaignFactoryV4.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

contract MockWaiverToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
}

contract MockPonsV2 {
    function maxCreatorTaxBps() external pure returns (uint256) { return 1000; }
}

/// Creation-fee gate: exact buy-in required, forwarded instantly to the
/// platform recipient, waived on-chain for qualified holders.
contract FeeGateTest is Test {
    CampaignFactoryV4 cf;
    MockWaiverToken waiver;
    address platform = address(0xFEE);
    address creator = address(0xC0FFEE);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        waiver = new MockWaiverToken();
        cf = new CampaignFactoryV4(
            platform, address(0x4EAA), 700, 300,
            IPonsV2Factory(address(new MockPonsV2())),
            IPonsV2LaunchAndBuy(address(0xBEEF1)),
            address(0xBEEF2),
            IPoolManagerMin(address(0xBEEF3)),
            address(0xBEEF4),
            IV4StateView(address(0xBEEF5)),
            new LegDeployerV2(),
            FEE,
            IERC20(address(waiver)),
            500_000 ether
        );
        vm.deal(creator, 1 ether);
    }

    function _meta() internal pure returns (PonsTokenMeta memory) {
        return PonsTokenMeta("Fee Gate", "FGT", "", "t", PonsSocials("", "", "", "", ""), address(0));
    }

    function _create(uint256 value) internal {
        vm.prank(creator);
        cf.createCampaign{value: value}(
            1 ether, 0.1 ether, 0, 0, block.timestamp + 1 days,
            0, 0, false, _meta(), 0, 0, new address[](0), new uint16[](0)
        );
    }

    function test_feeRequired_andForwarded() public {
        uint256 before = platform.balance;
        _create(FEE);
        assertEq(platform.balance - before, FEE, "fee not forwarded");
        assertEq(address(cf).balance, 0, "factory must never hold a balance");
        assertEq(cf.campaignCount(), 1);
    }

    function test_wrongFee_reverts() public {
        vm.expectRevert(CampaignFactoryV4.BadFee.selector);
        _create(0);
        vm.expectRevert(CampaignFactoryV4.BadFee.selector);
        _create(FEE + 1);
    }

    function test_waiver_holderCreatesFree() public {
        waiver.mint(creator, 500_000 ether);
        assertEq(cf.creationFeeFor(creator), 0, "holder should be waived");
        _create(0); // free for the holder
        assertEq(cf.campaignCount(), 1);
        // and paying anyway is rejected — exact fee only, no tips
        vm.expectRevert(CampaignFactoryV4.BadFee.selector);
        _create(FEE);
    }

    function test_waiver_belowThreshold_pays() public {
        waiver.mint(creator, 499_999 ether);
        assertEq(cf.creationFeeFor(creator), FEE);
        vm.expectRevert(CampaignFactoryV4.BadFee.selector);
        _create(0);
        _create(FEE);
    }

    function test_waiverDisabled_whenTokenZero() public {
        CampaignFactoryV4 noWaiver = new CampaignFactoryV4(
            platform, address(0x4EAA), 700, 300,
            IPonsV2Factory(address(new MockPonsV2())),
            IPonsV2LaunchAndBuy(address(0xBEEF1)),
            address(0xBEEF2),
            IPoolManagerMin(address(0xBEEF3)),
            address(0xBEEF4),
            IV4StateView(address(0xBEEF5)),
            new LegDeployerV2(),
            FEE,
            IERC20(address(0)),
            0
        );
        assertEq(noWaiver.creationFeeFor(creator), FEE, "zero token must mean no waiver, not free-for-all");
    }
}
