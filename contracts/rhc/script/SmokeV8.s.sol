// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignParams} from "../src/CampaignV3.sol";
import {CampaignV4} from "../src/CampaignV4.sol";
import {CampaignFactoryV6} from "../src/CampaignFactoryV6.sol";
import {FeeSplitterV4} from "../src/FeeSplitterV4.sol";
import {ProofBurner} from "../src/ProofBurner.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Curve} from "../src/interfaces/IPonsV2.sol";

/// Launch-day smoke: the first campaign on the v8 factory, and the first
/// $PLAUNCH burned by the flywheel. Mirrors test/ForkV8Lifecycle.t.sol
/// step for step, on mainnet, from the deployer:
///   create (0.001 ETH creation fee → burner) → take the one seat, locked
///   180 days → launch → one buy on the curve (creator tax accrues; pons's
///   sweep operator moves it later) → seed the burner past its 0.005 ETH
///   crank floor → crank → $PLAUNCH at 0x…dEaD.
///
///   forge script script/SmokeV8.s.sol --rpc-url rhc --broadcast \
///     --keystore ~/.rhc-deployer/<file> --password-file ~/.rhc-deployer/pw -vv
contract SmokeV8 is Script {
    CampaignFactoryV6 constant V8 = CampaignFactoryV6(0x2913c23b9ebBBbD2a863eb299F90D4fe6c0e30cb);
    ProofBurner constant BURNER = ProofBurner(payable(0xf17D0c79F7919Bd3363bA19423D652e47610E341));
    address constant PLAUNCH = 0x03a9667927cC3b24a8d004a5Ab1c92aA07255Db6;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function run() external {
        uint256 deadBefore = IERC20(PLAUNCH).balanceOf(DEAD);
        uint256 burnerBefore = address(BURNER).balance;

        vm.startBroadcast();

        // 1. the first v8 campaign: one seat, 0.005 ETH, 10% tax, Flywheel preset
        CampaignParams memory p;
        p.goal = 0.005 ether; p.minDeposit = 0.005 ether; p.maxDeposit = 0.005 ether; p.maxBackers = 1;
        p.deadline = block.timestamp + 1 days; p.creatorTaxBps = 1000;
        p.meta = PonsTokenMeta("Flywheel Smoke", "SMOKE", "", "First launch on the ProofLaunch v8 factory. Every trade burns $PLAUNCH.", PonsSocials("", "", "", "https://prooflaunch.fun/rhc/flywheel", ""), address(0));
        p.allowlist = new address[](0);
        CampaignV4 c = V8.createCampaign{value: 0.001 ether}(p, 1000, 0, new address[](0), new uint16[](0), bytes32(uint256(0x5eed05)));

        // 2. the seat, locked six months (the v8 feature, exercised on mainnet)
        c.depositLocked{value: 0.005 ether}(180);

        // 3. launch — one tx creates the token and buys with the pool
        c.launch();

        // 4. one real trade so creator tax exists on the curve
        IPonsV2Curve(c.curve()).buy{value: 0.003 ether}(0.003 ether, 0, msg.sender);

        // 5. seed the burner over its crank floor (creation fee already landed there)
        (bool ok, ) = address(BURNER).call{value: 0.004 ether}("");
        require(ok, "seed failed");

        // 6. the first burn
        BURNER.crank();

        vm.stopBroadcast();

        console2.log("campaign   :", address(c));
        console2.log("token      :", c.token());
        console2.log("curve      :", c.curve());
        console2.log("splitter   :", address(c.feeSplitter()));
        console2.log("burner ETH before / after:", burnerBefore, address(BURNER).balance);
        console2.log("burner totalEthSpent    :", BURNER.totalEthSpent());
        console2.log("burner totalTokensBurned:", BURNER.totalTokensBurned());
        console2.log("$PLAUNCH at dead, delta :", IERC20(PLAUNCH).balanceOf(DEAD) - deadBefore);
    }
}
