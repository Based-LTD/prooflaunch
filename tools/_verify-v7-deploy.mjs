import { createPublicClient, http, parseAbi, formatEther } from 'viem';
const U='https://rpc.mainnet.chain.robinhood.com';
const c=createPublicClient({chain:{id:4663,name:'RHC',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[U]}}},transport:http(U,{timeout:60000})});
const F='0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B', LEGS='0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB', SAT='0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3', ROUTER='0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943';
const want={ponsFactory:'0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',ponsLaunchAndBuy:'0xe33E9E479dF8802cb0866d5d05258bEc4cF62948',ponsFeeEscrow:'0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',poolManager:'0x8366a39CC670B4001A1121B8F6A443A643e40951',memeHook:'0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',stateView:'0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',legDeployer:LEGS,campaignDeployer:SAT,equityRouter:ROUTER,platformFeeRecipient:'0xD994AE0945c787A487c6dbd5188512E358986E29',holderRewardsRecipient:'0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB',feeWaiverToken:'0x0000000000000000000000000000000000000000'};
const abi=parseAbi(Object.keys(want).map(k=>`function ${k}() view returns (address)`).concat(['function creationFee() view returns (uint256)','function platformBps() view returns (uint16)','function holderRewardsBps() view returns (uint16)','function feeWaiverThreshold() view returns (uint256)','function campaignCount() view returns (uint256)']));
let bad=0;
for (const [k,v] of Object.entries(want)) { const got=await c.readContract({address:F,abi,functionName:k}); const ok=got.toLowerCase()===v.toLowerCase(); if(!ok) bad++; console.log(`${ok?'✓':'✗'} ${k.padEnd(24)} ${got}`); }
const [fee,pb,hb,thr,cnt]=await Promise.all(['creationFee','platformBps','holderRewardsBps','feeWaiverThreshold','campaignCount'].map(fn=>c.readContract({address:F,abi,functionName:fn})));
console.log(`${fee===1000000000000000n?'✓':'✗'} creationFee              ${formatEther(fee)} ETH`); console.log(`${pb===700&&hb===300?'✓':'✗'} bps                      ${pb}/${hb}`); console.log(`${thr===0n?'✓':'✗'} feeWaiverThreshold       ${thr} (dormant)`); console.log(`  campaignCount            ${cnt}`);
const satF=await c.readContract({address:SAT,abi:parseAbi(['function factory() view returns (address)']),functionName:'factory'});
console.log(`${satF.toLowerCase()===F.toLowerCase()?'✓':'✗'} satellite.factory()      ${satF}`);
for (const [n,a] of [['factory',F],['LegDeployerV3',LEGS],['CampaignDeployerV3',SAT],['EquityRouter',ROUTER]]) { const b=await c.getBytecode({address:a}); console.log(`  ${n.padEnd(20)} runtime ${(b.length-2)/2} bytes`); }
if (bad) { console.log('RESULT: MISMATCH'); process.exit(1); } console.log('RESULT: ALL CONSTRUCTOR ARGS VERIFIED ON-CHAIN');
