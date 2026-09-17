// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

interface IPonsV2FactoryPairs {
    function approvedPairTokens(address) external view returns (bool);
}

interface IERC20Std {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// v7 against LIVE pons V2: ERC20-quoted raises (USDG stablecoin and the
/// SPCX tokenized stock — both verified pons-approved pair assets), plus
/// a native seat-round sanity pass.
/// Run: forge test --match-contract ForkV3 --threads 1 -vv
contract ForkV3 is Test {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    // Every tokenized equity found live on-chain and confirmed as a
    // pons-approved pair asset (2026-09-16).
    address constant SNAP = 0xF6589F11Bc40b669e584073F428B05562F568733;
    address constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant LLY  = 0x8005d266423c7ea827372c9c864491e5786600ea;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    CampaignFactoryV5 cf;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        try vm.createSelectFork(RPC) {} catch {
            vm.skip(true);
            return;
        }
        cf = new CampaignFactoryV5(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(PONS_V2_FACTORY),
            IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY),
            PONS_V2_FEE_ESCROW,
            IPoolManagerMin(POOL_MANAGER), MEME_HOOK, IV4StateView(STATE_VIEW),
            new LegDeployerV2(),
            FEE, IERC20(address(0)), 0
        );
        vm.deal(creator, 3 ether);
        vm.deal(alice, 3 ether);
    }

    function _params(string memory sym, address quote) internal view returns (CampaignParams memory p) {
        p.goal = 1 ether;
        p.minDeposit = 0.01 ether;
        p.deadline = block.timestamp + 1 days;
        p.quoteToken = quote;
        p.meta = PonsTokenMeta(sym, sym, "", "fork test - never mainnet", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
    }

    function _erc20Lifecycle(address quote, string memory sym) internal {
        CampaignParams memory p = _params(sym, quote);
        // quote decimals vary (USDG 6? SPCX 18?) — size goal to the asset
        uint8 dec = IERC20Std(quote).decimals();
        p.goal = 2 * 10 ** dec;
        p.minDeposit = 10 ** dec / 100;

        uint256 launchFee = IPonsV2Factory(PONS_V2_FACTORY).launchFee();
        vm.prank(creator);
        CampaignV3 c = cf.createCampaign{value: FEE + launchFee}(
            p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(7))
        );

        // fund alice with the quote asset via storage-write deal
        deal(quote, alice, 10 * 10 ** dec);
        assertEq(IERC20Std(quote).balanceOf(alice), 10 * 10 ** dec, "deal failed on this token");

        vm.startPrank(alice);
        IERC20Std(quote).approve(address(c), type(uint256).max);
        c.depositToken(2 * 10 ** dec);
        vm.stopPrank();
        assertEq(c.totalRaised(), 2 * 10 ** dec);

        // withdraw + re-deposit proves the ERC20 money-back path live
        vm.prank(alice); c.withdraw();
        assertEq(IERC20Std(quote).balanceOf(alice), 10 * 10 ** dec, "withdraw not whole");
        vm.startPrank(alice);
        c.depositToken(2 * 10 ** dec);
        vm.stopPrank();

        vm.prank(creator);
        c.launch();

        address token = c.token();
        assertGt(token.code.length, 0, "token not deployed");
        assertGt(c.tokensAtLaunch(), 0, "no tokens from pooled ERC20 buy");
        console2.log(sym, "campaign (fork-only):", address(c));
        console2.log(sym, "token CA (fork-only):", token);
        console2.log(sym, "curve (fork-only):", c.curve());
        console2.log(sym, "launch OK, tokens:", c.tokensAtLaunch());
        console2.log(sym, "excess refunded (quote units):", c.excessAtLaunch());

        vm.prank(alice); c.claimTokens();
        assertEq(IERC20(token).balanceOf(alice), c.tokensAtLaunch(), "sole backer claims all");
    }

    function test_forkv3_usdgQuotedRaise() public {
        _erc20Lifecycle(USDG, "PLUSDG");
    }

    function test_forkv3_stockQuotedRaise_SPCX() public {
        _erc20Lifecycle(SPCX, "PLSPCX");
    }

    /// The whole tokenized-equity universe, not just one ticker: every
    /// stock pons approves can quote a community raise. If pons approves
    /// a new one tomorrow it works with no change on our side.
    function test_forkv3_everyApprovedStock() public {
        address[4] memory stocks = [SNAP, META, MSFT, LLY];
        string[4] memory names = ["PLSNAP", "PLMETA", "PLMSFT", "PLLLY"];
        for (uint256 i = 0; i < stocks.length; i++) {
            assertTrue(
                IPonsV2FactoryPairs(PONS_V2_FACTORY).approvedPairTokens(stocks[i]),
                "pons dropped approval for this stock"
            );
            _erc20Lifecycle(stocks[i], names[i]);
        }
    }

    function test_forkv3_native_seatRound_onLive() public {
        CampaignParams memory p = _params("PLV3N", address(0));
        p.maxBackers = 2;
        p.reservedSeats = 1;
        p.allowlist = new address[](1);
        p.allowlist[0] = alice;
        p.minDeposit = 0.5 ether;
        p.maxDeposit = 0.5 ether;
        p.goal = 1 ether;

        vm.prank(creator);
        CampaignV3 c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(9)));

        vm.prank(creator); c.deposit{value: 0.5 ether}(); // public seat
        vm.prank(alice); c.deposit{value: 0.5 ether}();   // reserved seat
        assertEq(uint256(c.seatBucket(alice)), 2);
        vm.prank(creator); c.launch();
        assertGt(c.token().code.length, 0, "native v3 launch failed on live pons");
    }
}
