// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignFactoryV4} from "../src/CampaignFactoryV4.sol";
import {CampaignV2} from "../src/CampaignV2.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// Fee-gated create → real launch on LIVE pons V2.
contract ForkFeeGate is Test {
    function test_fork_feeGatedCreate_launches() public {
        try vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com") {} catch {
            vm.skip(true);
            return;
        }
        CampaignFactoryV4 cf = new CampaignFactoryV4(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e),
            IPonsV2LaunchAndBuy(0xe33E9E479dF8802cb0866d5d05258bEc4cF62948),
            0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e,
            IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951),
            0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044,
            IV4StateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b),
            new LegDeployerV2(),
            0.001 ether, IERC20(address(0)), 0
        );
        address creator = address(0xC0FFEE);
        vm.deal(creator, 3 ether);
        uint256 platformBefore = address(0xFEE).balance; // mainnet dust exists at 0xFEE
        vm.startPrank(creator);
        CampaignV2 c = cf.createCampaign{value: 0.001 ether}(
            1 ether, 0.1 ether, 0, 0, block.timestamp + 1 days,
            0, 300, false,
            PonsTokenMeta("Fee Gate Probe", "FGP", "", "fork test", PonsSocials("", "", "", "", ""), address(0)),
            1000, 0, new address[](0), new uint16[](0)
        );
        c.deposit{value: 1 ether}();
        c.launch();
        vm.stopPrank();
        assertGt(c.token().code.length, 0, "launch through fee-gated factory failed");
        assertEq(address(0xFEE).balance - platformBefore, 0.001 ether, "fee not forwarded");
    }
}
