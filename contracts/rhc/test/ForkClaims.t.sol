// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {CampaignV3} from "../src/CampaignV3.sol";

interface IERC20View {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// Rehearsal of the one step every $PLAUNCH backer touches. Forks Robinhood
/// Chain at the current block, launches the real campaign from the real
/// launcher wallet, then claims from all twenty real seats and checks each
/// payout against the contract's own formula. Nothing is broadcast.
///
///   forge test --match-contract ForkClaims --fork-url rhc -vv
contract ForkClaims is Test {
    CampaignV3 constant CAMPAIGN = CampaignV3(payable(0xc2C9F89553DF78DCd830f6254717460247575eeD));
    address constant LAUNCHER = 0x04F2c8D303Fc0A3Df778212c1468e26281194140;
    address constant STRANGER = address(0x1111);

    function backers() internal pure returns (address[20] memory b) {
        b = [
            0x04F2c8D303Fc0A3Df778212c1468e26281194140,
            0xBe21e121592E1160c9d50950678998A8cbC8a4Df,
            0xc5654cF210A22aFbF428272852E217c3e5C30fd1,
            0x4C3E9f037E7B027e798946F199d804909aE507Aa,
            0xdA47A2DEB43514dDAf7Ae7DDcF9e4206F9CAd1ab,
            0x59C00898f9d363BAE2defCCa29952c8e0E295AeA,
            0x143B3D51879a58D30828BD5969295A27670beC24,
            0x9b0C5F1F1D425644d65fBf1E30097AE7C5576e14,
            0xd64f702C0c27B66aDDbFfAffE385798d5FB7F7EF,
            0x2a4A685d201937Ac64289f3A33e321964Fed98A4,
            0xbbDB2d4Cc1CB89AfD2611C6d3D455E1718beAeF7,
            0xFd1f937df2e64019D4e1e7eEC745A61176ab2cbE,
            0x499e725216A696025cF1f8744eAC89c42A4aeabB,
            0x8931fDdE50A6E3CFe7C4d8be34991Eb04A024bB4,
            0x5ee0F1Ddf2860c22d08B8482357f3d7cb7F54dAe,
            0x0cf43674e2Ff8aa07d904847f55E3C2AFDC3a9FA,
            0x9857f033F2aDDc9a9b84246A0713f8ab17A66dF9,
            0xB3e47cFd674c990c746B5682588284ba75584206,
            0xB118833170c89F259346293b143B03Ca7687A2bD,
            0x684E6a664Dcba0F647fEA47B73077b53766c1013
        ];
    }

    function test_fork_plaunch_launch_then_all_twenty_claim() public {
        assertEq(CAMPAIGN.backerCount(), 20, "roster size");
        if (CAMPAIGN.launched()) {
            emit log("$PLAUNCH has launched on mainnet; this pre-launch rehearsal is moot. Skipping.");
            return;
        }

        // 1. launch from the real launcher wallet
        vm.deal(LAUNCHER, 1 ether);
        vm.prank(LAUNCHER);
        CAMPAIGN.launch();
        assertTrue(CAMPAIGN.launched(), "launched");

        address token = CAMPAIGN.token();
        uint256 tokensAtLaunch = CAMPAIGN.tokensAtLaunch();
        uint256 raisedAtLaunch = CAMPAIGN.totalRaisedAtLaunch();
        uint256 supply = IERC20View(token).totalSupply();
        emit log_named_address("token", token);
        emit log_named_decimal_uint("tokensAtLaunch", tokensAtLaunch, 18);
        emit log_named_decimal_uint("raisedAtLaunch ETH", raisedAtLaunch, 18);
        emit log_named_decimal_uint("excessAtLaunch ETH", CAMPAIGN.excessAtLaunch(), 18);
        emit log_named_uint("pooled buy, bps of supply", (tokensAtLaunch * 10_000) / supply);
        assertEq(raisedAtLaunch, 1 ether, "1 ETH raised");
        assertEq(IERC20View(token).balanceOf(address(CAMPAIGN)), tokensAtLaunch, "campaign holds the pooled buy");

        // 2. every real seat claims; each payout must equal the contract's formula
        address[20] memory b = backers();
        uint256 paidOut;
        for (uint256 i = 0; i < 20; i++) {
            uint256 contrib = CAMPAIGN.contributionOf(b[i]);
            assertEq(contrib, 0.05 ether, "seat price");
            uint256 expected = (tokensAtLaunch * contrib) / raisedAtLaunch;
            uint256 before = IERC20View(token).balanceOf(b[i]);
            vm.deal(b[i], 0.01 ether);
            vm.prank(b[i]);
            CAMPAIGN.claimTokens();
            uint256 got = IERC20View(token).balanceOf(b[i]) - before;
            assertEq(got, expected, "claim matches formula");
            assertTrue(CAMPAIGN.tokensClaimed(b[i]), "marked claimed");
            paidOut += got;
        }
        emit log_named_decimal_uint("paid out to 20 seats", paidOut, 18);
        emit log_named_decimal_uint("dust left in campaign", tokensAtLaunch - paidOut, 18);
        assertLe(tokensAtLaunch - paidOut, 20, "rounding dust is at most 20 wei");
        assertEq(IERC20View(token).balanceOf(address(CAMPAIGN)), tokensAtLaunch - paidOut, "nothing else left");

        // 3. the two things that must fail
        vm.prank(b[0]);
        vm.expectRevert();
        CAMPAIGN.claimTokens(); // double claim

        vm.deal(STRANGER, 0.01 ether);
        vm.prank(STRANGER);
        vm.expectRevert();
        CAMPAIGN.claimTokens(); // never backed
    }
}
