// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {IPonsFactory, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IUniV3FactoryMin} from "../src/BurnLeg.sol";

// ── Mocks ────────────────────────────────────────────────────────────

contract MockToken {
    string public name = "Mock";
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract MockLocker {
    address public lastCollected;
    function collectFees(address t) external { lastCollected = t; }
    function feeRedirects(address) external pure returns (address) { return address(0); }
}

contract MockPons {
    uint256 public launchFee = 0.0005 ether;
    bool public launchEnabled = true;
    MockLocker public mockLocker = new MockLocker();
    address public lastFeeWallet;
    uint256 public lastValue;

    function locker() external view returns (address) { return address(mockLocker); }

    function launchToken(PonsTokenMeta calldata meta, uint256, uint256, bytes32)
        external payable returns (address)
    {
        lastFeeWallet = meta.feeWallet;
        lastValue = msg.value;
        MockToken t = new MockToken();
        // pretend curve: 1M tokens per ETH of initial buy — delivered to the
        // FEE WALLET, mirroring real pons behavior (fork-test discovery)
        t.mint(meta.feeWallet, ((msg.value - launchFee) * 1_000_000));
        return address(t);
    }
}

contract Reenterer {
    Campaign public c;
    constructor(Campaign c_) { c = c_; }
    function back() external payable { c.deposit{value: msg.value}(); }
    function attack() external { c.withdraw(); }
    receive() external payable {
        // try to reenter withdraw during the refund transfer
        try c.withdraw() { revert("reentered!"); } catch {}
    }
}

// ── Tests ────────────────────────────────────────────────────────────

contract CampaignTest is Test {
    MockPons pons;
    CampaignFactory cf;
    Campaign c;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address platform = address(0xFEE);
    address rewards = address(0x4EAA);

    function _meta() internal pure returns (PonsTokenMeta memory) {
        return PonsTokenMeta("Test", "TST", "", "test",
            PonsSocials("", "", "", "", ""), address(0));
    }

    function setUp() public {
        pons = new MockPons();
        cf = new CampaignFactory(platform, rewards, 500, 500, address(0xBEEF), IUniV3FactoryMin(address(0)), 10000);
        vm.prank(creator);
        c = cf.createCampaign(
            IPonsFactory(address(pons)),
            3 ether,      // goal
            0.1 ether,    // min
            2 ether,      // max
            10,           // slots
            block.timestamp + 3 days,
            0, 0, _meta(),
            0, new address[](0), new uint16[](0)
        );
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(creator, 1 ether);
    }

    function _fund() internal {
        vm.prank(alice); c.deposit{value: 2 ether}();
        vm.prank(bob);   c.deposit{value: 1.5 ether}();
    }

    // happy path ------------------------------------------------------

    function test_depositLaunchClaim() public {
        _fund();
        assertEq(c.totalRaised(), 3.5 ether);
        vm.prank(creator);
        c.launch();
        assertTrue(c.launched());
        // feeWallet must be the splitter, always
        assertEq(pons.lastFeeWallet(), address(c.feeSplitter()));
        // full pool went into the launch
        assertEq(pons.lastValue(), 3.5 ether);
        // pro-rata claims
        uint256 total = c.tokensAtLaunch();
        vm.prank(alice); c.claimTokens();
        vm.prank(bob);   c.claimTokens();
        MockToken t = MockToken(c.token());
        assertEq(t.balanceOf(alice), total * 2 ether / 3.5 ether);
        assertEq(t.balanceOf(bob), total * 1.5 ether / 3.5 ether);
    }

    function test_withdrawBeforeLaunch() public {
        _fund();
        uint256 before = alice.balance;
        vm.prank(alice); c.withdraw();
        assertEq(alice.balance, before + 2 ether);
        assertEq(c.totalRaised(), 1.5 ether);
    }

    // launch gating ---------------------------------------------------

    function test_strangerCannotLaunchEarly() public {
        _fund();
        vm.prank(alice);
        vm.expectRevert(Campaign.NotLaunchable.selector);
        c.launch();
    }

    function test_anyoneCanLaunchAfterDeadline() public {
        _fund();
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        c.launch();
        assertTrue(c.launched());
    }

    function test_cannotLaunchUnderGoal() public {
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(creator);
        vm.expectRevert(Campaign.NotLaunchable.selector);
        c.launch();
    }

    function test_cannotLaunchAfterGrace() public {
        _fund();
        vm.warp(block.timestamp + 3 days + c.GRACE() + 1);
        vm.prank(creator);
        vm.expectRevert(Campaign.NotLaunchable.selector);
        c.launch();
        // …and refunds are open instead, even though goal was met
        vm.prank(alice); c.refund();
    }

    // refunds ---------------------------------------------------------

    function test_refundGoalUnmet() public {
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.warp(block.timestamp + 3 days);
        uint256 before = alice.balance;
        vm.prank(alice); c.refund();
        assertEq(alice.balance, before + 1 ether);
    }

    function test_noRefundWhileLaunchable() public {
        _fund();
        vm.warp(block.timestamp + 3 days); // deadline hit, goal met, grace live
        vm.prank(alice);
        vm.expectRevert(Campaign.NotRefundable.selector);
        c.refund();
    }

    function test_cancelOpensRefunds() public {
        _fund();
        vm.prank(creator); c.cancel();
        vm.prank(alice); c.refund();
        vm.prank(bob); c.refund();
        assertEq(c.totalRaised(), 0);
    }

    // guards ----------------------------------------------------------

    function test_depositLimits() public {
        vm.prank(alice);
        vm.expectRevert(Campaign.BadAmount.selector);
        c.deposit{value: 0.05 ether}(); // below min
        vm.prank(alice);
        vm.expectRevert(Campaign.BadAmount.selector);
        c.deposit{value: 2.5 ether}(); // above max
    }

    function test_slotsEnforced() public {
        for (uint160 i = 1; i <= 10; i++) {
            address backer = address(i + 1000);
            vm.deal(backer, 1 ether);
            vm.prank(backer);
            c.deposit{value: 0.1 ether}();
        }
        vm.prank(alice);
        vm.expectRevert(Campaign.SlotsFull.selector);
        c.deposit{value: 0.1 ether}();
    }

    function test_doubleClaimBlocked() public {
        _fund();
        vm.prank(creator); c.launch();
        vm.prank(alice); c.claimTokens();
        vm.prank(alice);
        vm.expectRevert(Campaign.BadAmount.selector);
        c.claimTokens();
    }

    function test_withdrawReentrancyBlocked() public {
        Reenterer r = new Reenterer(c);
        vm.deal(address(this), 1 ether);
        r.back{value: 0.5 ether}();
        // the receive() hook tries to reenter withdraw; inner call must fail
        // and the outer must succeed exactly once
        r.attack();
        assertEq(c.contributionOf(address(r)), 0);
        assertEq(address(r).balance, 0.5 ether);
    }

    // fee splitter ----------------------------------------------------

    function test_feeSplit() public {
        _fund();
        vm.prank(creator); c.launch();
        FeeSplitter fs = c.feeSplitter();
        // simulate creator fees arriving (ETH for simplicity)
        vm.deal(address(fs), 1 ether);
        fs.distribute(address(0));
        // 90% backers, 5% rewards, 5% platform
        assertEq(fs.backerPool(address(0)), 0.9 ether);
        assertEq(fs.legOwed(rewards, address(0)), 0.05 ether);
        assertEq(fs.legOwed(platform, address(0)), 0.05 ether);
        // alice's entitlement = 0.9 * 2/3.5
        uint256 before = alice.balance;
        vm.prank(alice); fs.claimBacker(address(0));
        uint256 expected = uint256(0.9 ether) * 2 ether / 3.5 ether;
        assertEq(alice.balance, before + expected);
        // platform pulls its leg
        vm.prank(platform); fs.claimLeg(address(0));
        // double-pull reverts
        vm.prank(platform);
        vm.expectRevert(FeeSplitter.NothingToClaim.selector);
        fs.claimLeg(address(0));
    }

    function test_feeSplitAccumulatesAcrossRounds() public {
        _fund();
        vm.prank(creator); c.launch();
        FeeSplitter fs = c.feeSplitter();
        vm.deal(address(fs), 1 ether);
        vm.prank(alice); fs.claimBacker(address(0)); // round 1 claim
        vm.deal(address(fs), address(fs).balance + 1 ether); // round 2 fees
        vm.prank(alice); fs.claimBacker(address(0)); // only the delta
        // lifetime: 1.8 ETH backer pool × alice's 2/3.5 share
        uint256 lifetime = uint256(1.8 ether) * 2 ether / 3.5 ether;
        assertEq(fs.backerClaimed(alice, address(0)), lifetime);
    }
}
