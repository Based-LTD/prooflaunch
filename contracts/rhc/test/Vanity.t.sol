// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";
import {MockPonsFactory, MockLaunchAndBuy} from "./CampaignV3.t.sol";

/// Proves the 0x…5EED signature scheme end to end: grind a salt off-chain
/// (same formula the browser uses), deploy through the real factory, and
/// the campaign lands on the vanity address. Also pins the init-code-hash
/// derivation the frontend grinder must reproduce byte for byte.
contract VanityTest is Test {
    CampaignFactoryV5 cf;
    MockPonsFactory ponsF;
    MockLaunchAndBuy lab;
    address creator = address(0xC0FFEE);
    address constant PLATFORM = address(0xFEE);
    address constant REWARDS = address(0x4EAA);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        ponsF = new MockPonsFactory();
        lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV5(
            PLATFORM, REWARDS, 700, 300,
            IPonsV2Factory(address(ponsF)),
            IPonsV2LaunchAndBuy(address(lab)),
            address(0xE5C60),
            IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV2(),
            FEE, IERC20(address(0)), 0
        );
        vm.deal(creator, 10 ether);
    }

    function _params() internal view returns (CampaignParams memory p) {
        p.goal = 1 ether;
        p.minDeposit = 0.1 ether;
        p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("SEED", "SEED", "", "vanity", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
    }

    /// The exact init-code hash the CREATE2 address derives from. The
    /// browser grinder must build this identically: CampaignV3 creation
    /// code ++ abi.encode(the factory's constructor call).
    function _initCodeHash(CampaignParams memory p) internal view returns (bytes32) {
        address[] memory legs = new address[](2);
        uint16[] memory legBps = new uint16[](2);
        legs[0] = REWARDS; legBps[0] = 300;   // rewards leg first
        legs[1] = PLATFORM; legBps[1] = 700;  // platform leg LAST (dust absorber)
        return keccak256(
            abi.encodePacked(
                type(CampaignV3).creationCode,
                abi.encode(
                    creator,
                    IPonsV2Factory(address(ponsF)),
                    IPonsV2LaunchAndBuy(address(lab)),
                    address(0xE5C60),
                    p,
                    uint16(9000), // 10000 - 700 - 300, no bots, no vaults
                    legs,
                    legBps
                )
            )
        );
    }

    function test_vanity_grindAndDeploy_5EED() public {
        vm.pauseGasMetering();
        CampaignParams memory p = _params();
        // the browser's exact flow: one read for the hash, then grind
        bytes32 initHash = cf.previewInitCodeHash(
            creator, p, 0, 0, new address[](0), new uint16[](0), address(0), address(0)
        );
        assertEq(initHash, _initCodeHash(p), "preview view drifted from the real encoding");
        address deployer = address(cf.campaignDeployer());

        // grind: same math as the browser (0xff ++ deployer ++ salt ++ hash)
        bytes32 salt;
        address predicted;
        uint256 attempts;
        for (uint256 i = 0; i < 2_000_000; i++) {
            bytes32 s = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, s, initHash)))));
            attempts = i + 1;
            if (uint160(a) & 0xffff == 0x5eed) { salt = s; predicted = a; break; }
        }
        require(predicted != address(0), "no salt found");
        console2.log("attempts:", attempts);
        console2.log("salt:", uint256(salt));
        console2.log("predicted:", predicted);
        console2.log("initCodeHash:");
        console2.logBytes32(initHash);
        vm.resumeGasMetering();

        vm.prank(creator);
        CampaignV3 c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), salt);

        assertEq(address(c), predicted, "CREATE2 prediction must match the deployed address");
        assertEq(uint160(address(c)) & 0xffff, 0x5eed, "campaign did not land on the signature");
        console2.log("deployed:", address(c));
        console2.log("deployer (satellite):", deployer);
    }

    /// The preview must track the leg table exactly — including bots and
    /// vaults, where the ordering is load-bearing.
    function test_vanity_previewMatchesDeployed_withVaults() public {
        vm.pauseGasMetering();
        CampaignParams memory p = _params();
        address[] memory vaults = new address[](1);
        uint16[] memory vbps = new uint16[](1);
        vaults[0] = address(0xDA0);
        vbps[0] = 500;

        bytes32 initHash = cf.previewInitCodeHash(
            creator, p, 0, 0, vaults, vbps, address(0), address(0)
        );
        address deployer = address(cf.campaignDeployer());
        bytes32 salt = bytes32(uint256(777));
        address predicted = address(uint160(uint256(
            keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initHash))
        )));
        vm.resumeGasMetering();

        vm.prank(creator);
        CampaignV3 c = cf.createCampaign{value: FEE}(p, 0, 0, vaults, vbps, salt);
        assertEq(address(c), predicted, "preview address must equal deployed address with vaults");
    }

    /// With bot legs the browser supplies PREDICTED leg addresses (the
    /// satellite's next CREATE nonces). Same-tx prediction must hold.
    function test_vanity_previewMatchesDeployed_withBurnBot() public {
        vm.pauseGasMetering();
        CampaignParams memory p = _params();
        // LegDeployerV2 deploys with plain CREATE: next address is
        // rlp(deployer, nonce). vm.computeCreateAddress mirrors what the
        // frontend does with viem's getContractAddress.
        address legDeployerAddr = address(cf.legDeployer());
        uint64 nonce = vm.getNonce(legDeployerAddr);
        address predictedBurn = vm.computeCreateAddress(legDeployerAddr, nonce);

        bytes32 initHash = cf.previewInitCodeHash(
            creator, p, 1000, 0, new address[](0), new uint16[](0), predictedBurn, address(0)
        );
        address deployer = address(cf.campaignDeployer());
        bytes32 salt = bytes32(uint256(31337));
        address predicted = address(uint160(uint256(
            keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initHash))
        )));
        vm.resumeGasMetering();

        vm.prank(creator);
        CampaignV3 c = cf.createCampaign{value: FEE}(p, 1000, 0, new address[](0), new uint16[](0), salt);
        assertEq(address(c), predicted, "bot-leg nonce prediction must hold in the same tx");
    }

    /// A salt someone else already used must not brick creation — it
    /// reverts, the creator retries with the next salt. No funds at risk.
    function test_vanity_saltCollision_reverts() public {
        CampaignParams memory p = _params();
        vm.prank(creator);
        cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(1234)));
        vm.expectRevert();
        vm.prank(creator);
        cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(1234)));
    }
}
