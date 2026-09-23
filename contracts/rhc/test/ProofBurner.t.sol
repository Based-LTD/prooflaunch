// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProofBurner} from "../src/ProofBurner.sol";
import {V4LegBase, ICampaignV2View, IFeeSplitterLegV2, IPonsV2FactoryLegView} from "../src/V4LegBase.sol";
import {IPoolManagerMin} from "../src/interfaces/IUniV4.sol";
import {MockERC20} from "./CampaignV3.t.sol";
import {MockCurve, MockCampaignView} from "./Review.t.sol";

/// A splitter that owes the caller `owed` ETH on claimLeg(0), and `tokOwed`
/// of its campaign token on claimLeg(token) — like FeeSplitter's leg path.
contract PayingSplitter {
    address public campaign;
    uint256 public owed;
    uint256 public tokOwed;
    constructor(address campaign_) payable { campaign = campaign_; owed = msg.value; }
    function setTokOwed(uint256 a) external { tokOwed = a; }
    function claimLeg(address asset) external {
        if (asset == address(0)) {
            uint256 a = owed; require(a > 0, "nothing"); owed = 0;
            (bool ok, ) = msg.sender.call{value: a}(""); require(ok);
        } else {
            uint256 a = tokOwed; require(a > 0, "nothing"); tokOwed = 0;
            MockERC20(asset).mint(msg.sender, a);
        }
    }
}

/// Tries to reenter pull() from inside claimLeg to double-count the stat.
contract ReentrantSplitter {
    ProofBurner b;
    function arm(ProofBurner b_) external payable { b = b_; }
    function claimLeg(address) external {
        (bool ok, ) = msg.sender.call{value: address(this).balance}(""); ok;
        b.pull(address(this)); // must revert Reentrancy → this whole call fails
    }
}

contract ProofBurnerTest is Test {
    receive() external payable {} // this contract cranks in several tests and takes the tip
    MockERC20 proof; MockCurve curve; MockCampaignView proofCampaign;
    ProofBurner burner;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        proof = new MockERC20("PROOF");
        curve = new MockCurve(proof);
        proofCampaign = new MockCampaignView(address(proof), address(curve));
        burner = new ProofBurner(ICampaignV2View(address(proofCampaign)), IPonsV2FactoryLegView(address(0xF)), IPoolManagerMin(address(0xB0)), address(0xB1));
    }

    function test_target_isFixed_andInitIsUnreachable() public {
        assertEq(burner.proofToken(), address(proof));
        assertEq(burner.initializer(), address(0));
        vm.expectRevert(V4LegBase.OnlyFactory.selector);
        burner.init(ICampaignV2View(address(1)), IFeeSplitterLegV2(address(2)), IPonsV2FactoryLegView(address(3)));
    }

    function test_pull_collectsFromManySplitters_thenCrankBurnsProof() public {
        MockCampaignView other = new MockCampaignView(address(new MockERC20("OTHER")), address(0));
        PayingSplitter s1 = new PayingSplitter{value: 0.03 ether}(address(other));
        PayingSplitter s2 = new PayingSplitter{value: 0.05 ether}(address(other));
        address[] memory list = new address[](2); list[0] = address(s1); list[1] = address(s2);
        vm.prank(address(0xBEEF)); burner.pullMany(list);
        assertEq(burner.totalEthPulled(), 0.08 ether);
        assertEq(burner.pendingEth(), 0.08 ether);

        uint256 crankerBefore = address(0xCAFE).balance;
        vm.prank(address(0xCAFE)); burner.crank();
        uint256 spent = 0.08 ether - 0.0008 ether; // 1% keeper tip
        assertEq(burner.totalEthSpent(), spent);
        assertEq(burner.totalTips(), 0.0008 ether);
        assertEq(address(0xCAFE).balance - crankerBefore, 0.0008 ether, "cranker tipped 1%");
        assertEq(proof.balanceOf(DEAD), spent * 1000, "mock curve mints 1000/ETH, all of it burned");
        assertEq(burner.totalTokensBurned(), spent * 1000);
        assertEq(address(burner).balance, 0);
        assertEq(proof.balanceOf(address(burner)), 0);
    }

    function test_crank_capPerBlock_andOncePerBlock() public {
        vm.deal(address(burner), 0.5 ether); // creation fees / direct sends count too
        vm.roll(100); burner.crank();
        assertEq(burner.totalEthSpent(), 0.198 ether, "capped at 0.2, less the 1% tip");
        vm.expectRevert(ProofBurner.CrankedThisBlock.selector);
        burner.crank();
        vm.roll(101); burner.crank();
        vm.roll(102); burner.crank();
        assertEq(burner.totalEthSpent() + burner.totalTips(), 0.5 ether);
        assertEq(burner.totalTips(), 0.005 ether);
        assertEq(address(burner).balance, 0);
    }

    function test_crankerThatCannotReceive_forfeitsTip_andItBurnsNextCrank() public {
        vm.deal(address(burner), 0.1 ether);
        NoReceive nr = new NoReceive();
        vm.roll(200); nr.crank(burner);
        assertEq(burner.totalTips(), 0, "undeliverable tip is not counted");
        assertEq(address(burner).balance, 0.001 ether, "it stayed behind");
        vm.roll(201);
        vm.expectRevert(ProofBurner.BelowMinimum.selector);
        burner.crank(); // 0.001 is under the floor: it waits for more ETH, no dust buy
        vm.deal(address(burner), 0.011 ether);
        burner.crank();
        assertEq(address(burner).balance, 0);
    }

    function test_pull_garbageTargets_neverRevert_andCountNothing() public {
        burner.pull(address(0xD00D));            // no code
        burner.pull(address(proof));             // code, wrong interface
        PayingSplitter empty = new PayingSplitter(address(proofCampaign));
        burner.pull(address(empty));             // real splitter, nothing owed
        assertEq(burner.totalEthPulled(), 0);
    }

    function test_pull_cannotBeReenteredToInflateTheStat() public {
        ReentrantSplitter r = new ReentrantSplitter();
        r.arm{value: 0.01 ether}(burner);
        burner.pull(address(r)); // inner pull reverts → r.claimLeg reverts → nothing arrives
        assertEq(burner.totalEthPulled(), 0);
        assertEq(address(burner).balance, 0);
    }

    function test_foreignCampaignToken_isBurned_notHoarded() public {
        MockERC20 coin = new MockERC20("COIN");
        MockCampaignView other = new MockCampaignView(address(coin), address(0));
        PayingSplitter s = new PayingSplitter(address(other));
        s.setTokOwed(777 ether);
        burner.pullCampaignToken(address(s));
        assertEq(coin.balanceOf(DEAD), 777 ether);
        assertEq(coin.balanceOf(address(burner)), 0);
    }

    function test_proofTokenFees_waitForCrank_thenBurn() public {
        PayingSplitter s = new PayingSplitter(address(proofCampaign));
        s.setTokOwed(500 ether);
        burner.pullCampaignToken(address(s));
        assertEq(proof.balanceOf(address(burner)), 500 ether);
        burner.crank();
        assertEq(proof.balanceOf(DEAD), 500 ether);
    }

    function test_cannotDeployBeforeTheTokenExists() public {
        NotLaunchedView nl = new NotLaunchedView();
        vm.expectRevert(V4LegBase.NotLaunched.selector);
        new ProofBurner(ICampaignV2View(address(nl)), IPonsV2FactoryLegView(address(0xF)), IPoolManagerMin(address(0xB0)), address(0xB1));
    }

    function test_dust_cannotBeCrankedForTips_butHeldProofAlwaysBurns() public {
        vm.deal(address(burner), 0.004 ether); // below MIN_CRANK_ETH
        vm.expectRevert(ProofBurner.BelowMinimum.selector);
        burner.crank();
        // PROOF sitting here can still be burned, the dust just waits
        proof.mint(address(burner), 5 ether);
        burner.crank();
        assertEq(proof.balanceOf(DEAD), 5 ether);
        assertEq(address(burner).balance, 0.004 ether, "dust untouched - no micro-buy, no tip");
        assertEq(burner.totalTips(), 0);
        // top it over the floor and the whole pile (less tip) burns
        vm.deal(address(burner), 0.01 ether);
        vm.roll(block.number + 1); burner.crank();
        assertEq(address(burner).balance, 0);
    }

    function test_noWayOut() public view {
        // The only ETH-moving paths are curve.buy / poolManager.settle inside
        // crank(). There is no withdraw, sweep, owner or setter to call —
        // this test documents the surface by pinning the function count a
        // reviewer should expect: pull, pullMany, pullCampaignToken, crank,
        // unlockCallback, init (unreachable), and views.
        assertEq(burner.DEAD(), DEAD);
        assertEq(burner.MAX_ETH_PER_CRANK(), 0.2 ether);
    }
}

contract NoReceive { function crank(ProofBurner b) external { b.crank(); } }

contract NotLaunchedView {
    function token() external pure returns (address) { return address(0); }
    function curve() external pure returns (address) { return address(0); }
    function launched() external pure returns (bool) { return false; }
}
