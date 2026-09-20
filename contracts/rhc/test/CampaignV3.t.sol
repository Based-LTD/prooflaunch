// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, PonsV2LaunchParams} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

// ── mocks ────────────────────────────────────────────────────────────

contract MockERC20 {
    string public symbol;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor(string memory sym) { symbol = sym; }
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        require(balanceOf[msg.sender] >= a, "bal");
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allow");
        require(balanceOf[f] >= a, "bal");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract MockPonsFactory {
    uint256 public launchFee = 0.0005 ether;
    function maxCreatorTaxBps() external pure returns (uint256) { return 1000; }
    function previewLaunchEconomics(uint256, address) external pure returns (bytes32) { return bytes32(uint256(42)); }
}

/// Mints a fresh token to the recipient; simulates a graduation refund by
/// keeping only up to CAP of the quote and returning the rest.
contract MockLaunchAndBuy {
    uint256 public constant CAP = 4.2 ether;
    MockERC20 public lastToken;

    function launchAndBuy(
        PonsV2LaunchParams calldata,
        uint256,
        address pairToken,
        uint256 amountIn,
        uint256,
        address recipient,
        address[] calldata
    ) external payable returns (address token, address curve, uint256 out) {
        MockERC20 t = new MockERC20("MOCK");
        lastToken = t;
        t.mint(recipient, 1_000_000 ether);
        uint256 refund = amountIn > CAP ? amountIn - CAP : 0;
        if (pairToken == address(0)) {
            if (refund > 0) {
                (bool ok, ) = recipient.call{value: refund}("");
                require(ok);
            }
        } else {
            MockERC20(pairToken).transferFrom(msg.sender, address(this), amountIn);
            if (refund > 0) MockERC20(pairToken).transfer(recipient, refund);
        }
        return (address(t), address(0xC10DE), 1_000_000 ether);
    }
}

// ── tests ────────────────────────────────────────────────────────────

contract CampaignV3Test is Test {
    CampaignFactoryV5 cf;
    MockERC20 usdg;
    MockERC20 gate;
    MockPonsFactory ponsF;
    MockLaunchAndBuy lab;

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);
    address teamWallet = address(0x7EA1);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        usdg = new MockERC20("USDG");
        gate = new MockERC20("GATE");
        ponsF = new MockPonsFactory();
        lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV5(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(address(ponsF)),
            IPonsV2LaunchAndBuy(address(lab)),
            address(0xE5C60),
            IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV3(),
            FEE, IERC20(address(0)), 0,
            address(0)
        );
        for (uint160 i = 0; i < 5; i++) {
            address u = [creator, alice, bob, carol, teamWallet][i];
            vm.deal(u, 20 ether);
            usdg.mint(u, 100 ether);
        }
    }

    function _params() internal view returns (CampaignParams memory p) {
        p.goal = 1 ether;
        p.minDeposit = 0.1 ether;
        p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("V3T", "V3T", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
    }

    function _create(CampaignParams memory p) internal returns (CampaignV3 c) {
        uint256 v = FEE + (p.quoteToken == address(0) ? 0 : ponsF.launchFee());
        vm.prank(creator);
        c = cf.createCampaign{value: v}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(1)));
    }

    // ── team rounds ──────────────────────────────────────────────────

    function test_teamRound_reservedAndPublicSeats() public {
        CampaignParams memory p = _params();
        p.maxBackers = 3;
        p.reservedSeats = 1;
        p.allowlist = new address[](1);
        p.allowlist[0] = teamWallet;
        CampaignV3 c = _create(p);

        // two public wallets take the two public seats
        vm.prank(alice); c.deposit{value: 0.3 ether}();
        vm.prank(bob); c.deposit{value: 0.3 ether}();
        // third public wallet must be refused — the last seat is reserved
        vm.expectRevert(CampaignV3.SlotsFull.selector);
        vm.prank(carol); c.deposit{value: 0.3 ether}();
        // but the allowlisted wallet walks into the reserved seat
        vm.prank(teamWallet); c.deposit{value: 0.4 ether}();
        assertEq(c.backerCount(), 3);
        assertEq(uint256(c.seatBucket(teamWallet)), 2);
    }

    function test_allowlisted_overflowsIntoPublic_whenReservedFull() public {
        CampaignParams memory p = _params();
        p.maxBackers = 3;
        p.reservedSeats = 1;
        p.allowlist = new address[](2);
        p.allowlist[0] = teamWallet;
        p.allowlist[1] = carol;
        CampaignV3 c = _create(p);

        vm.prank(teamWallet); c.deposit{value: 0.3 ether}(); // takes THE reserved seat
        vm.prank(carol); c.deposit{value: 0.3 ether}();      // allowlisted, spills to public
        assertEq(uint256(c.seatBucket(carol)), 1);
    }

    function test_withdraw_freesTheRightBucket() public {
        CampaignParams memory p = _params();
        p.maxBackers = 2;
        p.reservedSeats = 1;
        p.allowlist = new address[](1);
        p.allowlist[0] = teamWallet;
        CampaignV3 c = _create(p);

        vm.prank(teamWallet); c.deposit{value: 0.3 ether}();
        vm.prank(teamWallet); c.withdraw();
        assertEq(c.reservedSeatsUsed(), 0, "reserved seat not freed");
        vm.prank(teamWallet); c.deposit{value: 0.3 ether}(); // can re-enter
        assertEq(uint256(c.seatBucket(teamWallet)), 2);
    }

    function test_reservedSeats_requireSlottedRaise() public {
        CampaignParams memory p = _params();
        p.maxBackers = 0;
        p.reservedSeats = 1;
        vm.expectRevert(); // BadAmount inside constructor
        vm.prank(creator);
        cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(0));
    }

    // ── token gating ─────────────────────────────────────────────────

    function test_gate_blocksAndAdmits() public {
        CampaignParams memory p = _params();
        p.gateToken = address(gate);
        p.gateMinBalance = 500 ether;
        CampaignV3 c = _create(p);

        vm.expectRevert(CampaignV3.GateFailed.selector);
        vm.prank(alice); c.deposit{value: 0.3 ether}();

        gate.mint(alice, 500 ether);
        vm.prank(alice); c.deposit{value: 0.3 ether}();
        assertEq(c.contributionOf(alice), 0.3 ether);
    }

    // ── ERC20 quote (USDG / stock tokens) ────────────────────────────

    function test_erc20Quote_fullLifecycle_withExcess() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg);
        p.goal = 5 ether; // above the mock's 4.2 graduation cap → excess
        CampaignV3 c = _create(p);
        assertEq(c.launchFeeEscrowed(), ponsF.launchFee(), "launch fee not escrowed");

        vm.startPrank(alice);
        usdg.approve(address(c), type(uint256).max);
        c.depositToken(3 ether);
        vm.stopPrank();
        vm.startPrank(bob);
        usdg.approve(address(c), type(uint256).max);
        c.depositToken(3 ether);
        vm.stopPrank();

        // native deposit into an ERC20 raise must be refused
        vm.expectRevert(CampaignV3.WrongAsset.selector);
        vm.prank(carol); c.deposit{value: 1 ether}();

        vm.prank(creator); c.launch();
        assertGt(c.tokensAtLaunch(), 0);
        assertEq(c.excessAtLaunch(), 1.8 ether, "6 in, 4.2 kept, 1.8 refunded");

        // claims: 50/50 tokens + 50/50 of the USDG excess
        uint256 aU = usdg.balanceOf(alice);
        vm.prank(alice); c.claimTokens();
        assertEq(usdg.balanceOf(alice) - aU, 0.9 ether);
        assertEq(IERC20(c.token()).balanceOf(alice), 500_000 ether);
    }

    function test_erc20Quote_withdraw_and_refund_and_feeReturn() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg);
        CampaignV3 c = _create(p);

        vm.startPrank(alice);
        usdg.approve(address(c), type(uint256).max);
        c.depositToken(0.5 ether);
        vm.stopPrank();

        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice); c.withdraw();
        assertEq(usdg.balanceOf(alice) - before, 0.5 ether, "withdraw full amount in USDG");

        vm.startPrank(bob);
        usdg.approve(address(c), type(uint256).max);
        c.depositToken(0.3 ether);
        vm.stopPrank();

        vm.warp(c.deadline() + 1);
        assertTrue(c.refundable());
        uint256 b0 = usdg.balanceOf(bob);
        vm.prank(bob); c.refund();
        assertEq(usdg.balanceOf(bob) - b0, 0.3 ether);

        // the creator's escrowed launch fee comes home
        uint256 c0 = creator.balance;
        c.refundLaunchFee();
        assertEq(creator.balance - c0, ponsF.launchFee());
        vm.expectRevert(CampaignV3.NotRefundable.selector);
        c.refundLaunchFee(); // no double dip
    }

    function test_erc20Quote_botsRefused() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg);
        uint256 v = FEE + ponsF.launchFee(); // evaluate BEFORE expectRevert arms
        vm.expectRevert(CampaignFactoryV5.BotsNeedNativeQuote.selector);
        vm.prank(creator);
        cf.createCampaign{value: v}(p, 1000, 0, new address[](0), new uint16[](0), bytes32(0));
    }

    // ── CREATE2 signature addresses ──────────────────────────────────

    function test_create2_saltDeterminesAddress() public {
        CampaignParams memory p = _params();
        CampaignV3 a = _create(p);
        p.deadline += 1; // vary args
        vm.prank(creator);
        CampaignV3 b = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(2)));
        assertTrue(address(a) != address(b));
        // same args + same salt from a different caller of the FACTORY can
        // never collide: the deployer satellite is the CREATE2 deployer and
        // only the factory can call it
        assertEq(address(cf.campaignDeployer().factory()), address(cf));
    }

    // ── native path still intact ─────────────────────────────────────

    function test_native_lifecycle_unchanged() public {
        CampaignParams memory p = _params();
        CampaignV3 c = _create(p);
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        vm.prank(bob); c.deposit{value: 0.5 ether}();
        vm.prank(creator); c.launch();
        vm.prank(alice); c.claimTokens();
        assertApproxEqAbs(IERC20(c.token()).balanceOf(alice), 545_454.545454 ether, 1e18);
    }
}
