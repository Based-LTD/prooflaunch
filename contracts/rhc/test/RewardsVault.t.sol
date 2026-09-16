// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardsVault, IERC20Pull, ISplitterLegPull} from "../src/RewardsVault.sol";

contract MockStakeToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract RewardsVaultTest is Test {
    RewardsVault vault;
    MockStakeToken token;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockStakeToken();
        vault = new RewardsVault(IERC20Pull(address(token)));
        for (uint160 i = 0; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            token.mint(u, 1_000_000 ether);
            vm.prank(u);
            token.approve(address(vault), type(uint256).max);
            vm.deal(u, 1 ether);
        }
    }

    function _pay(uint256 amt) internal {
        vm.deal(address(this), amt);
        (bool ok, ) = address(vault).call{value: amt}("");
        require(ok);
    }

    function test_singleStaker_getsWholeStream() public {
        vm.prank(alice); vault.stake(100 ether);
        _pay(1 ether);
        assertEq(vault.earned(alice), 1 ether);
        uint256 before = alice.balance;
        vm.prank(alice); vault.claim();
        assertEq(alice.balance - before, 1 ether);
        assertEq(vault.earned(alice), 0);
    }

    function test_proRata_andMidStreamJoin() public {
        vm.prank(alice); vault.stake(300 ether);
        _pay(0.9 ether); // all alice's
        vm.prank(bob); vault.stake(100 ether); // joins AFTER first stream
        _pay(0.8 ether); // 3:1 split → alice 0.6, bob 0.2
        assertApproxEqAbs(vault.earned(alice), 1.5 ether, 10);
        assertApproxEqAbs(vault.earned(bob), 0.2 ether, 10);
        uint256 a0 = alice.balance; uint256 b0 = bob.balance;
        vm.prank(alice); vault.claim();
        vm.prank(bob); vault.claim();
        assertApproxEqAbs(alice.balance - a0, 1.5 ether, 10);
        assertApproxEqAbs(bob.balance - b0, 0.2 ether, 10);
    }

    function test_ethBeforeAnyStaker_inheritedByFirst() public {
        _pay(0.5 ether); // nobody staked — waits unaccounted
        vm.prank(alice); vault.stake(10 ether);
        vault.distribute();
        assertEq(vault.earned(alice), 0.5 ether, "first staker inherits pre-stake revenue");
    }

    function test_unstake_keepsPending_stopsAccruing() public {
        vm.prank(alice); vault.stake(100 ether);
        _pay(0.4 ether);
        vm.prank(alice); vault.unstake(100 ether);
        assertEq(token.balanceOf(alice), 1_000_000 ether, "principal back in full");
        _pay(1 ether); // nobody staked -> unaccounted; alice must not accrue
        assertEq(vault.earned(alice), 0.4 ether, "pending kept, no new accrual");
        vm.prank(bob); vault.stake(1 ether);
        vault.distribute(); // bob inherits the 1 ether
        assertEq(vault.earned(bob), 1 ether);
        uint256 a0 = alice.balance;
        vm.prank(alice); vault.claim();
        assertEq(alice.balance - a0, 0.4 ether);
    }

    function test_claimZero_reverts() public {
        vm.prank(alice); vault.stake(1 ether);
        vm.expectRevert(RewardsVault.ZeroAmount.selector);
        vm.prank(alice); vault.claim();
    }

    function test_unstakeMoreThanStaked_reverts() public {
        vm.prank(alice); vault.stake(1 ether);
        vm.expectRevert(RewardsVault.Insufficient.selector);
        vm.prank(alice); vault.unstake(2 ether);
    }

    function test_solvency_invariant_underChurn() public {
        vm.prank(alice); vault.stake(100 ether);
        _pay(0.7 ether);
        vm.prank(bob); vault.stake(50 ether);
        _pay(0.3 ether);
        vm.prank(alice); vault.unstake(60 ether);
        _pay(0.2 ether);
        vm.prank(alice); vault.claim();
        vm.prank(bob); vault.claim();
        // whatever is left in the vault must cover whatever is still owed
        assertGe(address(vault).balance + 1, vault.earned(alice) + vault.earned(bob), "insolvent vault");
        // and dust only — nothing material stranded
        assertLe(address(vault).balance, 1e12, "material ETH stranded after full claims");
    }
}
