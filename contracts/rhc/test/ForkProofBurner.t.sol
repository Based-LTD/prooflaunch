// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {ProofBurner} from "../src/ProofBurner.sol";
import {ICampaignV2View, IPonsV2FactoryLegView} from "../src/V4LegBase.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2Curve} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView, PoolKey} from "../src/interfaces/IUniV4.sol";

interface IPonsV2FactoryGrad {
    function graduate(address token) external;
    function createGraduatedPool(address token) external returns (uint256 positionId);
}

/// The flywheel against LIVE pons V2: a "PROOF" token launched through our
/// v7 factory on a mainnet fork, then ProofBurner buying it with ETH that
/// arrived as fee legs — first on the pons curve, then on the graduated
/// Uniswap v4 pool. Run: forge test --match-contract ForkProofBurner --threads 1 -vv
contract ForkProofBurner is Test {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    CampaignFactoryV5 cf;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);

    function setUp() public {
        try vm.createSelectFork(RPC) {} catch { vm.skip(true); return; }
        cf = new CampaignFactoryV5(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(PONS_V2_FACTORY), IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY), PONS_V2_FEE_ESCROW,
            IPoolManagerMin(POOL_MANAGER), MEME_HOOK, IV4StateView(STATE_VIEW),
            new LegDeployerV3(), 0.001 ether, IERC20(address(0)), 0, address(0)
        );
        vm.deal(creator, 20 ether); vm.deal(alice, 20 ether);
    }

    function _launch(uint256 raise) internal returns (CampaignV3 c) {
        CampaignParams memory p;
        p.goal = raise; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days; p.creatorTaxBps = 300;
        p.meta = PonsTokenMeta("ProofBurner Probe", "PRFB", "", "fork test - never mainnet", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        vm.prank(creator);
        c = cf.createCampaign{value: 0.001 ether}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(0x5eed)));
        vm.prank(alice); c.deposit{value: raise}();
        vm.prank(creator); c.launch();
    }

    function test_fork_burner_curvePhase() public {
        CampaignV3 c = _launch(1 ether);
        assertFalse(IPonsV2Curve(c.curve()).graduated());
        ProofBurner b = new ProofBurner(ICampaignV2View(address(c)), IPonsV2FactoryLegView(PONS_V2_FACTORY), IPoolManagerMin(POOL_MANAGER), MEME_HOOK);
        assertEq(b.proofToken(), c.token());

        uint256 deadBefore = IERC20(c.token()).balanceOf(DEAD);
        vm.deal(address(b), 0.05 ether); // stands in for pulled legs + creation fees
        vm.roll(block.number + 1);
        vm.prank(address(0xBEEF)); b.crank();
        uint256 burned = IERC20(c.token()).balanceOf(DEAD) - deadBefore;
        console2.log("PROOF burned via curve:", burned);
        assertGt(burned, 0);
        assertEq(address(b).balance, 0);
        assertEq(b.totalTokensBurned(), burned);
    }

    function test_fork_burner_v4Phase_afterGraduation() public {
        CampaignV3 c = _launch(6 ether); // graduates at birth
        address token = c.token();
        assertTrue(IPonsV2Curve(c.curve()).graduated());
        PoolKey memory key = PoolKey(address(0), token, 0, 200, MEME_HOOK);
        bytes32 poolId = keccak256(abi.encode(key));
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(poolId);
        if (sqrtP == 0) {
            vm.startPrank(address(0xBEEF));
            try IPonsV2FactoryGrad(PONS_V2_FACTORY).graduate(token) {} catch {}
            try IPonsV2FactoryGrad(PONS_V2_FACTORY).createGraduatedPool(token) {} catch {}
            vm.stopPrank();
            (sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(poolId);
        }
        assertGt(sqrtP, 0, "v4 pool never came up");

        ProofBurner b = new ProofBurner(ICampaignV2View(address(c)), IPonsV2FactoryLegView(PONS_V2_FACTORY), IPoolManagerMin(POOL_MANAGER), MEME_HOOK);
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);
        vm.deal(address(b), 0.05 ether);
        vm.roll(block.number + 1);
        vm.prank(address(0xBEEF)); b.crank();
        uint256 burned = IERC20(token).balanceOf(DEAD) - deadBefore;
        console2.log("PROOF burned via v4 swap:", burned);
        assertGt(burned, 0);
        assertEq(address(b).balance, 0);
    }

    /// The real collection path: a second campaign's splitter owes this
    /// burner an ETH leg (it is one of that campaign's vault legs), pull()
    /// takes it, crank() burns PROOF with it.
    function test_fork_burner_pullsFromAnotherCampaignsSplitter() public {
        CampaignV3 proofC = _launch(1 ether);
        ProofBurner b = new ProofBurner(ICampaignV2View(address(proofC)), IPonsV2FactoryLegView(PONS_V2_FACTORY), IPoolManagerMin(POOL_MANAGER), MEME_HOOK);

        // another token whose splitter names the burner as a 30% vault leg
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days; p.creatorTaxBps = 300;
        p.meta = PonsTokenMeta("Other Coin", "OTHR", "", "fork test", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        address[] memory vaults = new address[](1); vaults[0] = address(b);
        uint16[] memory vbps = new uint16[](1); vbps[0] = 3000;
        vm.prank(creator);
        CampaignV3 other = cf.createCampaign{value: 0.001 ether}(p, 0, 0, vaults, vbps, bytes32(uint256(0xbeef)));
        vm.prank(alice); other.deposit{value: 1 ether}();
        vm.prank(creator); other.launch();

        // fees arrive at the splitter (stand-in for harvest from pons escrow)
        address sp = address(other.feeSplitter());
        vm.deal(sp, sp.balance + 0.1 ether);
        vm.prank(address(0xBEEF)); b.pull(sp);
        assertEq(b.totalEthPulled(), 0.03 ether, "30% leg pulled");

        uint256 deadBefore = IERC20(proofC.token()).balanceOf(DEAD);
        vm.roll(block.number + 1);
        vm.prank(address(0xBEEF)); b.crank();
        assertGt(IERC20(proofC.token()).balanceOf(DEAD) - deadBefore, 0, "another coin's fees burned PROOF");
        assertEq(b.totalEthSpent(), 0.03 ether);
    }
}
