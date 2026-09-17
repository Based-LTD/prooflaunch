// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardsVault, IERC20Pull, IEquityRouter} from "../src/RewardsVault.sol";
import {EquityRouter} from "../src/EquityRouter.sol";
import {IPoolManagerMin, PoolKey} from "../src/interfaces/IUniV4.sol";

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
}

contract StakeToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// "Hold $PROOF, get paid in Microsoft" — proven end to end against the
/// live v4 pools rather than a mock. Pool keys from RWA_POOLS.md.
contract RewardsVaultClaimAsTest is Test {
    IPoolManagerMin constant PM = IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;

    RewardsVault vault;
    EquityRouter router;
    StakeToken proof;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.createSelectFork("rhc");
        router = new EquityRouter(PM);
        proof = new StakeToken();
        vault = new RewardsVault(IERC20Pull(address(proof)), IEquityRouter(address(router)));

        proof.mint(alice, 1000e18);
        proof.mint(bob, 1000e18);
        vm.prank(alice); proof.approve(address(vault), type(uint256).max);
        vm.prank(bob); proof.approve(address(vault), type(uint256).max);
    }

    function _stake(address who, uint256 amt) internal {
        vm.prank(who); vault.stake(amt);
    }

    /// Fees arrive as ETH from a campaign's holder-rewards leg.
    function _fees(uint256 amt) internal {
        vm.deal(address(this), amt);
        (bool ok, ) = address(vault).call{value: amt}("");
        require(ok, "fee send");
        vault.distribute();
    }

    function _msftKey() internal pure returns (PoolKey memory) {
        return PoolKey(address(0), MSFT, 10000, 200, address(0));
    }

    /// The headline path: stake the platform token, earn ETH fees, walk
    /// away holding tokenized Microsoft.
    function test_claimAs_paysStock() public {
        _stake(alice, 100e18);
        _fees(0.5 ether);

        uint256 owed = vault.earned(alice);
        assertEq(owed, 0.5 ether, "alice should own the whole stream");

        vm.prank(alice);
        uint256 out = vault.claimAs(_msftKey(), 0);

        assertGt(out, 0, "no stock delivered");
        assertEq(IERC20Bal(MSFT).balanceOf(alice), out, "alice not credited");
        assertEq(vault.pendingOf(alice), 0, "claim not consumed");
        assertEq(address(vault).balance, vault.accountedEth(), "vault solvency broken");
        assertEq(IERC20Bal(MSFT).balanceOf(address(vault)), 0, "vault custodied stock");
        assertEq(IERC20Bal(MSFT).balanceOf(address(router)), 0, "router custodied stock");
    }

    /// Two stakers, two different preferences, same pool — the point of
    /// letting the claimer choose rather than the platform.
    function test_twoStakersChooseDifferentAssets() public {
        _stake(alice, 100e18);
        _stake(bob, 100e18);
        _fees(1 ether);

        vm.prank(alice);
        uint256 aOut = vault.claimAs(_msftKey(), 0);
        vm.prank(bob);
        uint256 bOut = vault.claimAs(PoolKey(address(0), SPCX, 3000, 30, address(0)), 0);

        assertGt(aOut, 0);
        assertGt(bOut, 0);
        assertEq(IERC20Bal(MSFT).balanceOf(alice), aOut);
        assertEq(IERC20Bal(SPCX).balanceOf(bob), bOut);
        assertEq(IERC20Bal(MSFT).balanceOf(bob), 0, "bob got the wrong asset");
        assertEq(address(vault).balance, vault.accountedEth(), "vault solvency broken");
    }

    /// The plain-ETH path must be completely unaffected — it is the
    /// escape hatch that makes a router bug survivable.
    function test_ethClaimStillWorks() public {
        _stake(alice, 100e18);
        _fees(0.3 ether);

        uint256 before = alice.balance;
        vm.prank(alice); vault.claim();
        assertEq(alice.balance - before, 0.3 ether, "eth claim wrong");
        assertEq(address(vault).balance, vault.accountedEth());
    }

    /// A failed swap must leave the claim INTACT, not burn it. Otherwise a
    /// slippage revert would cost a staker their rewards.
    function test_slippageRevert_doesNotConsumeClaim() public {
        _stake(alice, 100e18);
        _fees(0.4 ether);

        vm.prank(alice);
        vm.expectRevert();
        vault.claimAs(_msftKey(), 1_000_000e18);

        // still claimable, and still hers
        assertEq(vault.earned(alice), 0.4 ether, "claim was consumed by a failed swap");
        vm.prank(alice); vault.claim();
        assertEq(alice.balance, 0.4 ether, "could not recover after failed swap");
    }

    /// Claiming as stock must not quietly pay the rest of the pool.
    function test_claimAs_doesNotLeakToOtherStakers() public {
        _stake(alice, 100e18);
        _stake(bob, 300e18);
        _fees(1 ether);

        uint256 bobOwedBefore = vault.earned(bob);
        vm.prank(alice); vault.claimAs(_msftKey(), 0);

        assertEq(vault.earned(bob), bobOwedBefore, "bob's share moved");
        assertEq(bobOwedBefore, 0.75 ether, "pro-rata wrong");
        assertGe(address(vault).balance, vault.accountedEth(), "vault cannot cover bob");
    }

    function test_claimAs_zeroOwed_reverts() public {
        _stake(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(RewardsVault.ZeroAmount.selector);
        vault.claimAs(_msftKey(), 0);
    }

    /// A vault built without a router still works for ETH and refuses
    /// stock claims cleanly rather than reverting somewhere confusing.
    function test_noRouter_reverts() public {
        RewardsVault bare = new RewardsVault(IERC20Pull(address(proof)), IEquityRouter(address(0)));
        proof.mint(address(this), 10e18);
        proof.approve(address(bare), type(uint256).max);
        bare.stake(10e18);
        vm.deal(address(this), 1 ether);
        (bool ok, ) = address(bare).call{value: 0.1 ether}(""); require(ok);
        bare.distribute();

        vm.expectRevert(RewardsVault.NoRouter.selector);
        bare.claimAs(_msftKey(), 0);
    }
}
