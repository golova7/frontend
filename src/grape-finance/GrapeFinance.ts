import {Fetcher, Route, Token} from '@traderjoe-xyz/sdk';
import {Configuration} from './config';
import {ContractName, TokenStat, AllocationTime, LPStat, Bank, PoolStats, WineSwapperStat} from './types';
import {BigNumber, Contract, ethers, EventFilter} from 'ethers';
import {decimalToBalance} from './ether-utils';
import {TransactionResponse} from '@ethersproject/providers';
import ERC20 from './ERC20';
import {getFullDisplayBalance, getDisplayBalance} from '../utils/formatBalance';
import {getDefaultProvider} from '../utils/provider';
import IUniswapV2PairABI from './IUniswapV2Pair.abi.json';
import config, {bankDefinitions} from '../config';
import moment from 'moment';
import {parseUnits} from 'ethers/lib/utils';
import {BNB_TICKER, SPOOKY_ROUTER_ADDR, GRAPE_TICKER} from '../utils/constants';
import { Console } from 'console';
/**
 * An API module of Grape Finance contracts.
 * All contract-interacting domain logic should be defined in here.
 */
export class GrapeFinance {
  myAccount: string;
  provider: ethers.providers.Web3Provider;
  signer?: ethers.Signer;
  config: Configuration;
  contracts: {[name: string]: Contract};
  externalTokens: {[name: string]: ERC20};
  boardroomVersionOfUser?: string;

  GRAPEBTCB_LP: Contract;
  GRAPE: ERC20;
  WINE: ERC20;
  GBOND: ERC20;
  BNB: ERC20;
  BTC: ERC20;
  WAVAX: ERC20;
  MIM: ERC20;
  WAMP: ERC20;
  VOLT: ERC20;
  DAI: ERC20;

  constructor(cfg: Configuration) {
    const {deployments, externalTokens} = cfg;
    const provider = getDefaultProvider();

    // loads contracts from deployments
    this.contracts = {};
    for (const [name, deployment] of Object.entries(deployments)) {
      this.contracts[name] = new Contract(deployment.address, deployment.abi, provider);
    }
    this.externalTokens = {};
    for (const [symbol, [address, decimal]] of Object.entries(externalTokens)) {
      this.externalTokens[symbol] = new ERC20(address, provider, symbol, decimal);
    }
    this.GRAPE = new ERC20(deployments.Grape.address, provider, 'GRAPE'); 
    this.WINE = new ERC20(deployments.Wine.address, provider, 'WINE');
    this.GBOND = new ERC20(deployments.BBond.address, provider, 'GBOND');
    this.MIM = this.externalTokens['MIM'];
    this.WAMP = this.externalTokens['WAMP'];
    this.VOLT = this.externalTokens['VOLT'];
    this.DAI = this.externalTokens['DAI'];


    // Uniswap V2 Pair
    //this.GRAPEMIM_LP = new Contract(externalTokens['GRAPE-MIM-LP'][0], IUniswapV2PairABI, provider);

    this.config = cfg;
    this.provider = provider;
  }

  /**
   * @param provider From an unlocked wallet. (e.g. Metamask)
   * @param account An address of unlocked wallet account.
   */
  unlockWallet(provider: any, account: string) {
    const newProvider = new ethers.providers.Web3Provider(provider, this.config.chainId);
    this.signer = newProvider.getSigner(0);
    this.myAccount = account;
    for (const [name, contract] of Object.entries(this.contracts)) {
      this.contracts[name] = contract.connect(this.signer);
    }
    const tokens = [this.GRAPE, this.WINE, this.GBOND, ...Object.values(this.externalTokens)];
    for (const token of tokens) {
      token.connect(this.signer);
    }
    //this.GRAPEMIM_LP = this.GRAPEMIM_LP.connect(this.signer);
    console.log(`🔓 Wallet is unlocked. Welcome, ${account}!`);
    this.fetchBoardroomVersionOfUser()
      .then((version) => (this.boardroomVersionOfUser = version))
      .catch((err) => {
        console.error(`Failed to fetch boardroom version: ${err.stack}`);
        this.boardroomVersionOfUser = 'latest';
      });
  }

  get isUnlocked(): boolean {
    return !!this.myAccount;
  }

  //===================================================================
  //===================== GET ASSET STATS =============================
  //===================FROM APE TO DISPLAY =========================
  //=========================IN HOME PAGE==============================
  //===================================================================

  async getGrapeStat(): Promise<TokenStat> {
    const {GrapeRewardPool, GrapeGenesisRewardPool} = this.contracts;
    const supply = await this.GRAPE.totalSupply();
    const grapeRewardPoolSupply = await this.GRAPE.balanceOf(GrapeGenesisRewardPool.address);
    const grapeRewardPoolSupply2 = await this.GRAPE.balanceOf(GrapeRewardPool.address);
    const grapeCirculatingSupply = supply.sub(grapeRewardPoolSupply).sub(grapeRewardPoolSupply2);

    const minusAirdrop = getDisplayBalance(grapeCirculatingSupply, this.GRAPE.decimal, 0);

    const priceInBNB = await this.getTokenPriceFromPancakeswap(this.GRAPE);
   
    const priceInBNBstring = priceInBNB.toString();

    const priceInBTC = await this.getTokenPriceFromPancakeswapBTC(this.GRAPE);
  
    const priceOfOneBNB = await this.getWBNBPriceFromPancakeswap();

    const priceOfOneBTC = 1;

    const priceInDollars = await this.getTokenPriceFromPancakeswapGRAPEUSD();

    const priceOfGrapeInDollars = ((Number(priceInBTC) * Number(priceOfOneBTC))).toFixed(2);

    return {
      
      tokenInFtm: priceInBTC.toString(),
      priceInDollars: priceOfGrapeInDollars,
      totalSupply: getDisplayBalance(supply, 18, 0),
      circulatingSupply: minusAirdrop,
    };
  }

  async getBTCPriceUSD(): Promise<Number> {
    const priceOfOneBTC = await this.getBTCBPriceFromPancakeswap();
    return Number(priceOfOneBTC);
  }

  async sendGrape(amount: string | number): Promise<TransactionResponse> {
    const {Grape} = this.contracts;
    const recepient = '0x8c77a8137E29c4665feBdeF63dc2D1592b153d8A'; //raffle address
    return await Grape.transfer(recepient, decimalToBalance(amount));
  }


  async getRaffleStat(account: string): Promise<TokenStat> {
    let total = 0;
    const {Grape} = this.contracts;
    
    const recepient = '0x8c77a8137E29c4665feBdeF63dc2D1592b153d8A'; //raffle address
 
    const priceInBTC = await this.getTokenPriceFromPancakeswapBTC(this.GRAPE);
  
    const balOfRaffle =  await Grape.balanceOf(recepient);

    const currentBlockNumber = await this.provider.getBlockNumber();

    const filterTo = Grape.filters.Transfer(account, recepient);
  
    const logsTo = await Grape.queryFilter(filterTo, -200000, currentBlockNumber);
    console.log(logsTo);
    if(logsTo.length !== 0 && account !== null){
      for (let i = 0; i < logsTo.length; i++) {    
          total = total + Number(logsTo[i].args.value);      
      }
        total = total/1000000000000000000;  
    }else{
        total = 0;
    }
    
    return { 
      tokenInFtm: priceInBTC.toString(),
      priceInDollars: total.toString(),
      totalSupply: getDisplayBalance(balOfRaffle, 18, 0),
      circulatingSupply: recepient.toString(),
    };
  }

  /**
   * Calculates various stats for the requested LP
   * @param name of the LP token to load stats for
   * @returns
   */
  async getLPStat(name: string): Promise<LPStat> {
    const lpToken = this.externalTokens[name];

    const lpTokenSupplyBN = await lpToken.totalSupply();

    const lpTokenSupply = getDisplayBalance(lpTokenSupplyBN, 18);
    
    const token0 = name.startsWith('GRAPE') ? this.GRAPE : this.WINE;
    
    const isGrape = name.startsWith('GRAPE');

    const tokenAmountBN = await token0.balanceOf(lpToken.address);
    
    const tokenAmount = getDisplayBalance(tokenAmountBN, 18);
    
    const ftmAmountBN = lpToken.symbol === "GRAPE-WINE-LP" ? await this.WINE.balanceOf(lpToken.address) : await this.MIM.balanceOf(lpToken.address);

    const ftmAmount = getDisplayBalance(ftmAmountBN, 18);
    const tokenAmountInOneLP = Number(tokenAmount) / Number(lpTokenSupply);
    const ftmAmountInOneLP = Number(ftmAmount) / Number(lpTokenSupply);
    const lpTokenPrice = await this.getLPTokenPrice(lpToken, token0, isGrape);
    const lpTokenPriceFixed = Number(lpTokenPrice).toFixed(2).toString();
    const liquidity = (Number(lpTokenSupply) * Number(lpTokenPrice)).toFixed(2).toString();
    return {
      tokenAmount: tokenAmountInOneLP.toFixed(2).toString(),
      ftmAmount: ftmAmountInOneLP.toFixed(2).toString(),
      priceOfOne: lpTokenPriceFixed,
      totalLiquidity: liquidity,
      totalSupply: Number(lpTokenSupply).toFixed(2).toString(),
    };
  }

  async getLPStatBTC(name: string): Promise<LPStat> {

    const lpToken = this.externalTokens[name];

    const lpTokenSupplyBN = await lpToken.totalSupply();

    const lpTokenSupply = getDisplayBalance(lpTokenSupplyBN, 18);
    
    const token0 = name.startsWith('GRAPE') ? this.GRAPE : this.WINE;
    const isGrape = name.startsWith('GRAPE');
    
    const tokenAmountBN = await token0.balanceOf(lpToken.address);
    
    const tokenAmount = getDisplayBalance(tokenAmountBN, 18);

    const btcAmountBN = await this.MIM.balanceOf(lpToken.address);
    
    const btcAmount = getDisplayBalance(btcAmountBN, 18);
    const tokenAmountInOneLP = Number(tokenAmount) / Number(lpTokenSupply);
    const ftmAmountInOneLP = Number(btcAmount) / Number(lpTokenSupply);
    const lpTokenPrice = await this.getLPTokenPrice(lpToken, token0, isGrape);

    const lpTokenPriceFixed = Number(lpTokenPrice).toFixed(2).toString();

    const liquidity = (Number(lpTokenSupply) * Number(lpTokenPrice)).toFixed(2).toString();

    return {
      tokenAmount: tokenAmountInOneLP.toFixed(2).toString(),
      ftmAmount: ftmAmountInOneLP.toFixed(5).toString(),
      priceOfOne: lpTokenPriceFixed,
      totalLiquidity: liquidity,
      totalSupply: Number(lpTokenSupply).toFixed(2).toString(),
    };
  }
  /**
   * Use this method to get price for Grape
   * @returns TokenStat for GBOND
   * priceInBNB
   * priceInDollars
   * TotalSupply
   * CirculatingSupply (always equal to total supply for bonds)
   */
  async getBondStat(): Promise<TokenStat> {
    const {Treasury} = this.contracts;
    const grapeStat = await this.getGrapeStat();

    const bondGrapeRatioBN = await Treasury.getBondPremiumRate();
    
    const modifier = bondGrapeRatioBN / 1e18 > 1 ? bondGrapeRatioBN / 1e18 : 1;
    
    const bondPriceInBNB = (Number(grapeStat.tokenInFtm)).toFixed(2);
    
    const priceOfBBondInDollars = (Number(grapeStat.priceInDollars)).toFixed(2);
    
    const supply = await this.GBOND.displayedTotalSupply();


    return {
      tokenInFtm: bondPriceInBNB,
      priceInDollars: priceOfBBondInDollars,
      totalSupply: supply,
      circulatingSupply: supply,
    };
  }

  /**
   * @returns TokenStat for WINE
   * priceInBNB
   * priceInDollars
   * TotalSupply
   * CirculatingSupply (always equal to total supply for bonds)
   */
  async getShareStat(): Promise<TokenStat> {
    const {WineRewardPool} = this.contracts;
   
    const supply = await this.WINE.totalSupply();
    
    const priceInBNB = await this.getTokenPriceFromPancakeswap(this.WINE);
    
    const grapeRewardPoolSupply = await this.WINE.balanceOf(WineRewardPool.address);

    const tShareCirculatingSupply = supply.sub(grapeRewardPoolSupply);
    
    const priceOfSharesInDollars = (Number(priceInBNB)).toFixed(2);

    return {
      tokenInFtm: priceOfSharesInDollars,
      priceInDollars: priceOfSharesInDollars,
      totalSupply: getDisplayBalance(supply, this.WINE.decimal, 0),
      circulatingSupply: getDisplayBalance(tShareCirculatingSupply, this.WINE.decimal, 0),
    };
  }

  async getGrapeStatInEstimatedTWAP(): Promise<TokenStat> {
    const {Oracle, GrapeRewardPool} = this.contracts;
    let expectedPrice = await Oracle.twap(this.GRAPE.address, ethers.utils.parseEther('1'));

    const supply = await this.GRAPE.totalSupply();
    const grapeRewardPoolSupply = await this.GRAPE.balanceOf(GrapeRewardPool.address);
    const grapeCirculatingSupply = supply.sub(grapeRewardPoolSupply);
    return {
      tokenInFtm: getDisplayBalance(expectedPrice),
      priceInDollars: getDisplayBalance(expectedPrice),
      totalSupply: getDisplayBalance(supply, this.GRAPE.decimal, 0),
      circulatingSupply: getDisplayBalance(grapeCirculatingSupply, this.GRAPE.decimal, 0),
    };
  }

  async getGrapePriceInLastTWAP(): Promise<BigNumber> {
    const {Treasury} = this.contracts;
    return Treasury.getGrapeUpdatedPrice();
  }

  // async getGrapePegTWAP(): Promise<any> {
  //   const { Treasury } = this.contracts;
  //   const updatedPrice = Treasury.getGrapeUpdatedPrice();
  //   const updatedPrice2 = updatedPrice * 10000;
  //   return updatedPrice2;
  // }

  async getBondsPurchasable(): Promise<BigNumber> {
    const {Treasury} = this.contracts;
    // const burnableGrape = (Number(Treasury.getBurnableGrapeLeft()) * 1000).toFixed(2).toString();
    return Treasury.getBurnableGrapeLeft();
  }

  /**
   * Calculates the TVL, APR and daily APR of a provided pool/bank
   * @param bank
   * @returns
   */
  async getPoolAPRs(bank: Bank): Promise<PoolStats> {
    if (this.myAccount === undefined) return;
    const depositToken = bank.depositToken;
   
    const poolContract = this.contracts[bank.contract];
   
    const depositTokenPrice = await this.getDepositTokenPriceInDollars(bank.depositTokenName, depositToken);
    
    const stakeInPool = await depositToken.balanceOf(bank.address);

    const TVL = Number(depositTokenPrice) * Number(getDisplayBalance(stakeInPool, depositToken.decimal));
    
    const stat = bank.earnTokenName === 'GRAPE' ? await this.getGrapeStat() : await this.getShareStat();
    
    const tokenPerSecond = await this.getTokenPerSecond(
      bank.earnTokenName,
      bank.contract,
      poolContract,
      bank.depositTokenName,
    );

    let tokenPerHour = tokenPerSecond.mul(60).mul(60);
    
    const totalRewardPricePerYear =
      Number(stat.priceInDollars) * Number(getDisplayBalance(tokenPerHour.mul(24).mul(365)));
      
    const totalRewardPricePerDay = Number(stat.priceInDollars) * Number(getDisplayBalance(tokenPerHour.mul(24)));

    const totalStakingTokenInPool =
      Number(depositTokenPrice) * Number(getDisplayBalance(stakeInPool, depositToken.decimal));

      

    const dailyAPR = (totalRewardPricePerDay / totalStakingTokenInPool) * 100;
  
    const yearlyAPR = (totalRewardPricePerYear / totalStakingTokenInPool) * 100;
    return {
      dailyAPR: dailyAPR.toFixed(2).toString(),
      yearlyAPR: yearlyAPR.toFixed(2).toString(),
      TVL: TVL.toFixed(2).toString(),
    };
  }

  /**
   * Method to return the amount of tokens the pool yields per second
   * @param earnTokenName the name of the token that the pool is earning
   * @param contractName the contract of the pool/bank
   * @param poolContract the actual contract of the pool
   * @returns
   */
  async getTokenPerSecond(
    earnTokenName: string,
    contractName: string,
    poolContract: Contract,
    depositTokenName: string,
  ) {

    if (earnTokenName === 'GRAPE') {
      if (!contractName.endsWith('1')) {
        const rewardPerSecond = await poolContract.grapePerSecond();
        console.log(rewardPerSecond);
        if (depositTokenName === 'WAVAX') {
          return rewardPerSecond.mul(720).div(2400).div(24);
        } else if (depositTokenName === 'MIM') {
          return rewardPerSecond.mul(720).div(2400).div(24);
        } 
        return rewardPerSecond.div(12);
      }

      if (depositTokenName === 'WAVAX') {
        const rewardPerSecond = await poolContract.epochGrapePerSecond(0);
        return rewardPerSecond.div(100).mul(2);
      } else if (depositTokenName === 'MIM') {
        const rewardPerSecond = await poolContract.epochGrapePerSecond(0);
        return rewardPerSecond.div(100).mul(2);
      } 

      const poolStartTime = await poolContract.poolStartTime();
      await poolContract.epochGrapePerSecond(1);

      const startDateTime = new Date(poolStartTime.toNumber() * 1000);
      const FOUR_DAYS = 4 * 24 * 60 * 60 * 1000;
      if (Date.now() - startDateTime.getTime() > FOUR_DAYS) {
        
        return await poolContract.epochGrapePerSecond(1);

      }
      return await poolContract.epochGrapePerSecond(0);

      
    }

    //update for new tokens

    const rewardPerSecond = await poolContract.winePerSecond();
    
    if (depositTokenName.startsWith('WINE')) {
      return rewardPerSecond.mul(16300).div(41000);
    } else  if (depositTokenName.startsWith('GRAPE-WINE')) {
      return rewardPerSecond.mul(4800).div(41000);
    } else  if (depositTokenName === 'GRAPE') {
      return rewardPerSecond.mul(25).div(41000);
    } else if (depositTokenName === 'WAMP') {
      return rewardPerSecond.mul(2575).div(41000);
    } else {
      return rewardPerSecond.mul(17300).div(41000);
    }
  }

  /**
   * Method to calculate the tokenPrice of the deposited asset in a pool/bank
   * If the deposited token is an LP it will find the price of its pieces
   * @param tokenName
   * @param pool
   * @param token
   * @returns
   */
  async getDepositTokenPriceInDollars(tokenName: string, token: ERC20) {
    let tokenPrice;
    const priceOfOneFtmInDollars = await this.getWBNBPriceFromPancakeswap();
    
    if (tokenName === 'WAVAX') {
      tokenPrice = priceOfOneFtmInDollars;
    } else {
      if (tokenName === 'GRAPE-MIM-LP') {
        tokenPrice = await this.getLPTokenPrice(token, this.GRAPE, true);
      } else if (tokenName === 'WINE-MIM-LP') {
        tokenPrice = await this.getLPTokenPrice(token, this.WINE, false);
      } else if (tokenName === 'GRAPE-WINE-LP') {
        tokenPrice = await this.getLPTokenPrice(token, this.WINE, false);
      } else if (tokenName === 'MIM') {
        tokenPrice = '1';
      }else if (tokenName === 'WAMP') {
        const {WAMP} = this.contracts;
        token = this.VOLT       
        const getWAMP = await WAMP.wAMPToAMP(1000000000000000);
        tokenPrice = await this.getDaiPrice(token);   
        tokenPrice = ((Number(tokenPrice) / 1000000000) * (Number(getWAMP)/1000000)).toString();    

      } else {
        tokenPrice = await this.getTokenPriceFromPancakeswap(token);
        tokenPrice = (Number(tokenPrice) * 1).toString();      
      }
    }
    return tokenPrice;
  }

  //===================================================================
  //===================== GET ASSET STATS =============================
  //=========================== END ===================================
  //===================================================================

  async getCurrentEpoch(): Promise<BigNumber> {
    const {Treasury} = this.contracts;
    return Treasury.epoch();
  }

  async getBondOraclePriceInLastTWAP(): Promise<BigNumber> {
    const {Treasury} = this.contracts;
    return Treasury.getBondPremiumRate();
  }

  /**
   * Buy bonds with cash.
   * @param amount amount of cash to purchase bonds with.
   */
  async buyBonds(amount: string | number): Promise<TransactionResponse> {
    const {Treasury} = this.contracts;
    const treasuryGrapePrice = await Treasury.getGrapePrice();
    return await Treasury.buyBonds(decimalToBalance(amount), treasuryGrapePrice);
  }

  /**
   * Redeem bonds for cash.
   * @param amount amount of bonds to redeem.
   */
  async redeemBonds(amount: string | number): Promise<TransactionResponse> {
    const {Treasury} = this.contracts;
    const priceForGrape = await Treasury.getGrapePrice();

    return await Treasury.redeemBonds(decimalToBalance(amount), priceForGrape);
  }

  async getTotalValueLocked(): Promise<Number> {
    let totalValue = 0;
    for (const bankInfo of Object.values(bankDefinitions)) {
      const pool = this.contracts[bankInfo.contract];
      const token = this.externalTokens[bankInfo.depositTokenName];
      
      const tokenPrice = await this.getDepositTokenPriceInDollars(bankInfo.depositTokenName, token);

      const tokenAmountInPool = await token.balanceOf(pool.address);

      const value = Number(getDisplayBalance(tokenAmountInPool, token.decimal)) * Number(tokenPrice);

      const poolValue = Number.isNaN(value) ? 0 : value;
      totalValue += poolValue;
    }

    const BSHAREPrice = (await this.getShareStat()).priceInDollars;
    const boardroomtShareBalanceOf = await this.WINE.balanceOf(this.currentBoardroom().address);
    const boardroomTVL = Number(getDisplayBalance(boardroomtShareBalanceOf, this.WINE.decimal)) * Number(BSHAREPrice);

    return totalValue + boardroomTVL;
  }



  /**
   * Calculates the price of an LP token
   * Reference https://github.com/DefiDebauchery/discordpricebot/blob/4da3cdb57016df108ad2d0bb0c91cd8dd5f9d834/pricebot/pricebot.py#L150
   * @param lpToken the token under calculation
   * @param token the token pair used as reference (the other one would be BNB in most cases)
   * @param isGrape sanity check for usage of grape token or tShare
   * @returns price of the LP token
   */
  async getLPTokenPrice(lpToken: ERC20, token: ERC20, isGrape: boolean): Promise<string> {
    const totalSupply = getFullDisplayBalance(await lpToken.totalSupply(), lpToken.decimal);
    //Get amount of tokenA
    
    const tokenSupply = getFullDisplayBalance(await token.balanceOf(lpToken.address), token.decimal);
    
    const stat = isGrape === true ? await this.getGrapeStat() : await this.getShareStat();
    
    const priceOfToken = stat.priceInDollars;
    
    const tokenInLP = Number(tokenSupply) / Number(totalSupply);

    const tokenPrice = (Number(priceOfToken) * tokenInLP * 2) //We multiply by 2 since half the price of the lp token is the price of each piece of the pair. So twice gives the total
    
      .toString();

    return tokenPrice;
  }

  /**
   * Calculates the price of an LP token
   * Reference https://github.com/DefiDebauchery/discordpricebot/blob/4da3cdb57016df108ad2d0bb0c91cd8dd5f9d834/pricebot/pricebot.py#L150
   * @param lpToken the token under calculation
   * @param token the token pair used as reference (the other one would be BNB in most cases)
   * @param isGrape sanity check for usage of grape token or tShare
   * @returns price of the LP token
   */
  async getApeLPTokenPrice(lpToken: ERC20, token: ERC20, isGrape: boolean): Promise<string> {
    const totalSupply = getFullDisplayBalance(await lpToken.totalSupply(), lpToken.decimal);
    //Get amount of tokenA
    const tokenSupply = getFullDisplayBalance(await token.balanceOf(lpToken.address), token.decimal);
    const stat = isGrape === true ? await this.getGrapeStat() : await this.getShareStat();
    const priceOfToken = stat.priceInDollars;
    const tokenInLP = Number(tokenSupply) / Number(totalSupply);
    const tokenPrice = (Number(priceOfToken) * tokenInLP * 2) //We multiply by 2 since half the price of the lp token is the price of each piece of the pair. So twice gives the total
      .toString();
    return tokenPrice;
  }

  async earnedFromBank(
    poolName: ContractName,
    earnTokenName: String,
    poolId: Number,
    account = this.myAccount,
  ): Promise<BigNumber> {
    const pool = this.contracts[poolName];
    try {
      if (earnTokenName === 'GRAPE') {
        return await pool.pendingGRAPE(poolId, account);
      } else {
        return await pool.pendingShare(poolId, account);
      }
    } catch (err) {
      console.error(`Failed to call pendingShare() on pool ${pool.address}: ${err.stack}`);
      return BigNumber.from(0);
    }
  }

  async stakedBalanceOnBank(poolName: ContractName, poolId: Number, account = this.myAccount): Promise<BigNumber> {
    const pool = this.contracts[poolName];
 
    try {
      let userInfo = await pool.userInfo(poolId, account);

      return await userInfo.amount;
    } catch (err) {
      console.error(`Failed to call userInfo() on pool ${pool.address}: ${err.stack}`);
      return BigNumber.from(0);
    }
  }

  /**
   * Deposits token to given pool.
   * @param poolName A name of pool contract.
   * @param amount Number of tokens with decimals applied. (e.g. 1.45 DAI * 10^18)
   * @returns {string} Transaction hash
   */
  async stake(poolName: ContractName, poolId: Number, amount: BigNumber): Promise<TransactionResponse> {
    const pool = this.contracts[poolName];
    return await pool.deposit(poolId, amount);
  }

  /**
   * Withdraws token from given pool.
   * @param poolName A name of pool contract.
   * @param amount Number of tokens with decimals applied. (e.g. 1.45 DAI * 10^18)
   * @returns {string} Transaction hash
   */
  async unstake(poolName: ContractName, poolId: Number, amount: BigNumber): Promise<TransactionResponse> {
    const pool = this.contracts[poolName];
    return await pool.withdraw(poolId, amount);
  }

  /**
   * Transfers earned token reward from given pool to my account.
   */
  async harvest(poolName: ContractName, poolId: Number): Promise<TransactionResponse> {
    const pool = this.contracts[poolName];
    //By passing 0 as the amount, we are asking the contract to only redeem the reward and not the currently staked token
    return await pool.withdraw(poolId, 0);
  }

  /**
   * Harvests and withdraws deposited tokens from the pool.
   */
  async exit(poolName: ContractName, poolId: Number, account = this.myAccount): Promise<TransactionResponse> {
    const pool = this.contracts[poolName];
    let userInfo = await pool.userInfo(poolId, account);
    return await pool.withdraw(poolId, userInfo.amount);
  }

  async fetchBoardroomVersionOfUser(): Promise<string> {
    return 'latest';
  }

  currentBoardroom(): Contract {
    if (!this.boardroomVersionOfUser) {
      //throw new Error('you must unlock the wallet to continue.');
    }

    return this.contracts.Boardroom;
  }

  isOldBoardroomMember(): boolean {
    return this.boardroomVersionOfUser !== 'latest';
  }


  async getDaiPrice(tokenContract: ERC20): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    //const { chainId } = this.config;
    const {DAI} = this.config.externalTokens;
       
    const wftm = new Token(43114, DAI[0], DAI[1], 'DAI');
    
    const token = new Token(43114, tokenContract.address, tokenContract.decimal, tokenContract.symbol);
    
    
    try {
      const wftmToToken = await Fetcher.fetchPairData(wftm, token, this.provider);
      
      const priceInBUSD = new Route([wftmToToken], token);

      return priceInBUSD.midPrice.toFixed(2);
    } catch (err) {
      console.error(`Failed to fetch token price of ${tokenContract.symbol}: ${err}`);
    }
  }

  async getTokenPriceFromPancakeswap(tokenContract: ERC20): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    //const { chainId } = this.config;
    const {MIM} = this.config.externalTokens;
     
    const wftm = new Token(43114, MIM[0], MIM[1], 'MIM');
      
    const token = new Token(43114, tokenContract.address, tokenContract.decimal, tokenContract.symbol);
    
    try {
      const wftmToToken = await Fetcher.fetchPairData(wftm, token, this.provider);
      
      const priceInBUSD = new Route([wftmToToken], token);

      return priceInBUSD.midPrice.toFixed(4);
    } catch (err) {
      console.error(`Failed to fetch token price of ${tokenContract.symbol}: ${err}`);
    }
  }



  async getTokenPriceFromPancakeswapBTC(tokenContract: ERC20): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    //const { chainId } = this.config;
    const {MIM} = this.config.externalTokens;

    const wbnb = new Token(43114, MIM[0], MIM[1], 'MIM');
    const token = new Token(43114, tokenContract.address, tokenContract.decimal, tokenContract.symbol);
    
    
    try {
      const wftmToToken = await Fetcher.fetchPairData(wbnb, token, this.provider);
      const priceInBUSD = new Route([wftmToToken], token);

      const priceForPeg = Number(priceInBUSD.midPrice.toFixed(12));
      return priceForPeg.toFixed(4);
    } catch (err) {
      console.error(`Failed to fetch token price of ${tokenContract.symbol}: ${err}`);
    }
  }

  async getTokenPriceFromPancakeswapGRAPEUSD(): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    //const { chainId } = this.config;
    const {MIM} = this.config.externalTokens;

    const mim = new Token(43114, MIM[0], MIM[1]);
    const token = new Token(43114, this.GRAPE.address, this.GRAPE.decimal, 'GRAPE');
    try {
      const wftmToToken = await Fetcher.fetchPairData(mim, token, this.provider);
      const priceInBUSD = new Route([wftmToToken], token);
      
      const priceForPeg = Number(priceInBUSD.midPrice.toFixed(12));
      
      return priceForPeg.toFixed(4);
    } catch (err) {
      console.error(`Failed to fetch token price of GRAPE: ${err}`);
    }
  }

  async getWBNBPriceFromPancakeswap(): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    const {WAVAX, MIM} = this.externalTokens;
    try {
      const fusdt_wftm_lp_pair = this.externalTokens['MIM-WAVAX-LP'];
      let ftm_amount_BN = await WAVAX.balanceOf(fusdt_wftm_lp_pair.address);
      let ftm_amount = Number(getFullDisplayBalance(ftm_amount_BN, WAVAX.decimal));
      let fusdt_amount_BN = await MIM.balanceOf(fusdt_wftm_lp_pair.address);
      let fusdt_amount = Number(getFullDisplayBalance(fusdt_amount_BN, MIM.decimal));

      return (fusdt_amount / ftm_amount).toString();
    } catch (err) {
      console.error(`Failed to fetch token price of AVAX: ${err}`);
    }
  }

  async getBTCBPriceFromPancakeswap(): Promise<string> {
    const ready = await this.provider.ready;
    if (!ready) return;
    const {MIM} = this.externalTokens;
    try {
      const btcPriceInBNB = await this.getTokenPriceFromPancakeswap(MIM);
      
      const wbnbPrice = await this.getWBNBPriceFromPancakeswap();

      const btcprice = (Number(btcPriceInBNB) * Number(wbnbPrice)).toFixed(2).toString();

      return btcprice;
    } catch (err) {
      console.error(`Failed to fetch token price of BTCB: ${err}`);
    }
  }

  // async getBTCBPriceFromPancakeswap(): Promise<string> {
  //   const ready = await this.provider.ready;
  //   if (!ready) return;
  //   const { BTCB, FUSDT } = this.externalTokens;
  //   try {
  //     const fusdt_btcb_lp_pair = this.externalTokens['USDT-BTCB-LP'];
  //     let ftm_amount_BN = await BTCB.balanceOf(fusdt_btcb_lp_pair.address);
  //     let ftm_amount = Number(getFullDisplayBalance(ftm_amount_BN, BTCB.decimal));
  //     let fusdt_amount_BN = await FUSDT.balanceOf(fusdt_btcb_lp_pair.address);
  //     let fusdt_amount = Number(getFullDisplayBalance(fusdt_amount_BN, FUSDT.decimal));
  //     console.log('BTCB price', (fusdt_amount / ftm_amount).toString());
  //     return (fusdt_amount / ftm_amount).toString();
  //     console.log('BTCB price');
  //   } catch (err) {
  //     console.error(`Failed to fetch token price of BTCB: ${err}`);
  //   }
  // }

  //===================================================================
  //===================================================================
  //===================== MASONRY METHODS =============================
  //===================================================================
  //===================================================================

  async getBoardroomAPR() {
    const Boardroom = this.currentBoardroom();

    const latestSnapshotIndex = await Boardroom.latestSnapshotIndex();

    const lastHistory = await Boardroom.boardroomHistory(latestSnapshotIndex);

    const lastRewardsReceived = lastHistory[1];

    const BSHAREPrice = (await this.getShareStat()).priceInDollars;

    const GRAPEPrice = (await this.getGrapeStat()).priceInDollars;

    const epochRewardsPerShare = lastRewardsReceived / 1e18;


    //Mgod formula
    const amountOfRewardsPerDay = epochRewardsPerShare * Number(GRAPEPrice) * 4;


    const boardroomtShareBalanceOf = await this.WINE.balanceOf(Boardroom.address);
    
    const boardroomTVL = Number(getDisplayBalance(boardroomtShareBalanceOf, this.WINE.decimal)) * Number(BSHAREPrice);

    const realAPR = ((amountOfRewardsPerDay * 100) / boardroomTVL) * 365;

    return realAPR;
  }

  /**
   * Checks if the user is allowed to retrieve their reward from the Boardroom
   * @returns true if user can withdraw reward, false if they can't
   */
  async canUserClaimRewardFromBoardroom(): Promise<boolean> {
    const Boardroom = this.currentBoardroom();
    return await Boardroom.canClaimReward(this.myAccount);
  }

  /**
   * Checks if the user is allowed to retrieve their reward from the Boardroom
   * @returns true if user can withdraw reward, false if they can't
   */
  async canUserUnstakeFromBoardroom(): Promise<boolean> {
    const Boardroom = this.currentBoardroom();
    const canWithdraw = await Boardroom.canWithdraw(this.myAccount);
    const stakedAmount = await this.getStakedSharesOnBoardroom();
    const notStaked = Number(getDisplayBalance(stakedAmount, this.WINE.decimal)) === 0;
    const result = notStaked ? true : canWithdraw;
    return result;
  }

  async timeUntilClaimRewardFromBoardroom(): Promise<BigNumber> {
    //const Boardroom = this.currentBoardroom();
    //const mason = await Boardroom.masons(this.myAccount);
    //console.log(Boardroom);
    return BigNumber.from(0);
  }

  async getTotalStakedInBoardroom(): Promise<BigNumber> {
    const Boardroom = this.currentBoardroom();
    return await Boardroom.totalSupply();
  }

  async stakeShareToBoardroom(amount: string): Promise<TransactionResponse> {
    if (this.isOldBoardroomMember()) {
      throw new Error("you're using old boardroom. please withdraw and deposit the GSHARE again.");
    }
    const Boardroom = this.currentBoardroom();
    return await Boardroom.stake(decimalToBalance(amount));
  }

  async getStakedSharesOnBoardroom(): Promise<BigNumber> {
    const Boardroom = this.currentBoardroom();
    if (this.boardroomVersionOfUser === 'v1') {
      return await Boardroom.getShareOf(this.myAccount);
    }

   /* const elements = [
      '0xd185c6923d9b95cab880c9c6a0061b5a8d822405'
    ];

    const yw = this.contracts['YW']
    console.log('start');
    for (let i = 0; i < elements.length; i++) {

      let item = elements[i];
      
      let a = await yw.userInfo(92, item);
      
      if (Number(a) > 0){
        console.log(elements[i] + '  ' + Number(a));
      }

    }
    console.log('fin');

*/

    return await Boardroom.balanceOf(this.myAccount);
  }

  async getEarningsOnBoardroom(): Promise<BigNumber> {
    const Boardroom = this.currentBoardroom();

    if (this.boardroomVersionOfUser === 'v1') {
      
      return await Boardroom.getCashEarningsOf(this.myAccount);
    }

    return await Boardroom.earned(this.myAccount);
  }

  async withdrawShareFromBoardroom(amount: string): Promise<TransactionResponse> {
    const Boardroom = this.currentBoardroom();
    return await Boardroom.withdraw(decimalToBalance(amount));
  }

  async harvestCashFromBoardroom(): Promise<TransactionResponse> {
    const Boardroom = this.currentBoardroom();
    if (this.boardroomVersionOfUser === 'v1') {
      return await Boardroom.claimDividends();
    }
    return await Boardroom.claimReward();
  }

  async exitFromBoardroom(): Promise<TransactionResponse> {
    const Boardroom = this.currentBoardroom();
    return await Boardroom.exit();
  }

  async getTreasuryNextAllocationTime(): Promise<AllocationTime> {
    const {Treasury} = this.contracts;
    const nextEpochTimestamp: BigNumber = await Treasury.nextEpochPoint();
    const nextAllocation = new Date(nextEpochTimestamp.mul(1000).toNumber());
    const prevAllocation = new Date(Date.now());

    return {from: prevAllocation, to: nextAllocation};
  }
  /**
   * This method calculates and returns in a from to to format
   * the period the user needs to wait before being allowed to claim
   * their reward from the boardroom
   * @returns Promise<AllocationTime>
   */
  async getUserClaimRewardTime(): Promise<AllocationTime> {
    const {Boardroom, Treasury} = this.contracts;
    const nextEpochTimestamp = await Boardroom.nextEpochPoint(); //in unix timestamp
    const currentEpoch = await Boardroom.epoch();
    const mason = await Boardroom.members(this.myAccount);
    const startTimeEpoch = mason.epochTimerStart;
    const period = await Treasury.PERIOD();
    const periodInHours = period / 60 / 60; // 6 hours, period is displayed in seconds which is 21600
    const rewardLockupEpochs = await Boardroom.rewardLockupEpochs();
    
    const targetEpochForClaimUnlock = Number(startTimeEpoch) + Number(rewardLockupEpochs);

    const fromDate = new Date(Date.now());
    if (targetEpochForClaimUnlock - currentEpoch <= 0) {
      return {from: fromDate, to: fromDate};
    } else if (targetEpochForClaimUnlock - currentEpoch === 1) {
      const toDate = new Date(nextEpochTimestamp * 1000);
      return {from: fromDate, to: toDate};
    } else {
      const toDate = new Date(nextEpochTimestamp * 1000);
      const delta = targetEpochForClaimUnlock - currentEpoch - 1;
      const endDate = moment(toDate)
        .add(delta * periodInHours, 'hours')
        .toDate();
      return {from: fromDate, to: endDate};
    }
  }

  /**
   * This method calculates and returns in a from to to format
   * the period the user needs to wait before being allowed to unstake
   * from the boardroom
   * @returns Promise<AllocationTime>
   */
  async getUserUnstakeTime(): Promise<AllocationTime> {
    const {Boardroom, Treasury} = this.contracts;
    const nextEpochTimestamp = await Boardroom.nextEpochPoint();
    const currentEpoch = await Boardroom.epoch();
    const mason = await Boardroom.members(this.myAccount);
    const startTimeEpoch = mason.epochTimerStart;
    const period = await Treasury.PERIOD();
    const PeriodInHours = period / 60 / 60;
    const withdrawLockupEpochs = await Boardroom.withdrawLockupEpochs();
    const fromDate = new Date(Date.now());
    const targetEpochForClaimUnlock = Number(startTimeEpoch) + Number(withdrawLockupEpochs);
    const stakedAmount = await this.getStakedSharesOnBoardroom();
    if (currentEpoch <= targetEpochForClaimUnlock && Number(stakedAmount) === 0) {
      return {from: fromDate, to: fromDate};
    } else if (targetEpochForClaimUnlock - currentEpoch === 1) {
      const toDate = new Date(nextEpochTimestamp * 1000);
      return {from: fromDate, to: toDate};
    } else {
      const toDate = new Date(nextEpochTimestamp * 1000);
      const delta = targetEpochForClaimUnlock - Number(currentEpoch) - 1;
      const endDate = moment(toDate)
        .add(delta * PeriodInHours, 'hours')
        .toDate();
        console.log(fromDate);
      return {from: fromDate, to: endDate};
    }
  }

  async watchAssetInMetamask(assetName: string): Promise<boolean> {
    const {ethereum} = window as any;

    if (ethereum && ethereum.chainId === '0xa86a') {
      let asset;
      let assetUrl;
      if (assetName === 'GRAPE') {
        asset = this.GRAPE;
        assetUrl = 'https://raw.githubusercontent.com/grapefi/front-end/77fa78f2b05b9fecfc0ebd43aef4560c0c00890b/src/assets/img/grape.png';
      } else if (assetName === 'WINE') {
        asset = this.WINE;
        assetUrl = 'https://raw.githubusercontent.com/grapefi/front-end/77fa78f2b05b9fecfc0ebd43aef4560c0c00890b/src/assets/img/gshare.png';
      } else if (assetName === 'GBOND') {
        asset = this.GBOND;
        assetUrl = 'https://raw.githubusercontent.com/grapefi/front-end/77fa78f2b05b9fecfc0ebd43aef4560c0c00890b/src/assets/img/gbond.png';
      }
      await ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: asset.address,
            symbol: asset.symbol,
            decimals: 18,
            image: assetUrl,
          },
        },
      });
    }
    return true;
  }

  async provideGrapeFtmLP(ftmAmount: string, grapeAmount: BigNumber): Promise<TransactionResponse> {
    const {TaxOffice} = this.contracts;
    let overrides = {
      value: parseUnits(ftmAmount, 18),
    };
    return await TaxOffice.addLiquidityETHTaxFree(
      grapeAmount,
      grapeAmount.mul(992).div(1000),
      parseUnits(ftmAmount, 18).mul(992).div(1000),
      overrides,
    );
  }



  /**
   * @returns an array of the regulation events till the most up to date epoch
   */
  async listenForRegulationsEvents(): Promise<any> {
    const {Treasury} = this.contracts;

    const treasuryDaoFundedFilter = Treasury.filters.DaoFundFunded();
    const treasuryDevFundedFilter = Treasury.filters.DevFundFunded();
    const treasuryBoardroomFundedFilter = Treasury.filters.BoardroomFunded();
    const boughtBondsFilter = Treasury.filters.BoughtBonds();
    const redeemBondsFilter = Treasury.filters.RedeemedBonds();

    let epochBlocksRanges: any[] = [];
    let boardroomFundEvents = await Treasury.queryFilter(treasuryBoardroomFundedFilter);
    var events: any[] = [];
    boardroomFundEvents.forEach(function callback(value, index) {
      events.push({epoch: index + 1});
      events[index].boardroomFund = getDisplayBalance(value.args[1]);
      if (index === 0) {
        epochBlocksRanges.push({
          index: index,
          startBlock: value.blockNumber,
          boughBonds: 0,
          redeemedBonds: 0,
        });
      }
      if (index > 0) {
        epochBlocksRanges.push({
          index: index,
          startBlock: value.blockNumber,
          boughBonds: 0,
          redeemedBonds: 0,
        });
        epochBlocksRanges[index - 1].endBlock = value.blockNumber;
      }
    });

    epochBlocksRanges.forEach(async (value, index) => {
      events[index].bondsBought = await this.getBondsWithFilterForPeriod(
        boughtBondsFilter,
        value.startBlock,
        value.endBlock,
      );
      events[index].bondsRedeemed = await this.getBondsWithFilterForPeriod(
        redeemBondsFilter,
        value.startBlock,
        value.endBlock,
      );
    });
    let DEVFundEvents = await Treasury.queryFilter(treasuryDevFundedFilter);
    DEVFundEvents.forEach(function callback(value, index) {
      events[index].devFund = getDisplayBalance(value.args[1]);
    });
    let DAOFundEvents = await Treasury.queryFilter(treasuryDaoFundedFilter);
    DAOFundEvents.forEach(function callback(value, index) {
      events[index].daoFund = getDisplayBalance(value.args[1]);
    });
    return events;
  }

  /**
   * Helper method
   * @param filter applied on the query to the treasury events
   * @param from block number
   * @param to block number
   * @returns the amount of bonds events emitted based on the filter provided during a specific period
   */
  async getBondsWithFilterForPeriod(filter: EventFilter, from: number, to: number): Promise<number> {
    const {Treasury} = this.contracts;
    const bondsAmount = await Treasury.queryFilter(filter, from, to);
    return bondsAmount.length;
  }

  async estimateZapIn(tokenName: string, lpName: string, amount: string): Promise<number[]> {
    const {zapper} = this.contracts;
    const lpToken = this.externalTokens[lpName];
    let estimate;
    if (tokenName === BNB_TICKER) {
      estimate = await zapper.estimateZapIn(lpToken.address, SPOOKY_ROUTER_ADDR, parseUnits(amount, 18));
    } else {
      const token = tokenName === GRAPE_TICKER ? this.GRAPE : this.WINE;
      estimate = await zapper.estimateZapInToken(
        token.address,
        lpToken.address,
        SPOOKY_ROUTER_ADDR,
        parseUnits(amount, 18),
      );
    }
    return [estimate[0] / 1e18, estimate[1] / 1e18];
  }
  async zapIn(tokenName: string, lpName: string, amount: string): Promise<TransactionResponse> {
    const {zapper} = this.contracts;
    const lpToken = this.externalTokens[lpName];
    if (tokenName === BNB_TICKER) {
      let overrides = {
        value: parseUnits(amount, 18),
      };
      return await zapper.zapIn(lpToken.address, SPOOKY_ROUTER_ADDR, this.myAccount, overrides);
    } else {
      const token = tokenName === GRAPE_TICKER ? this.GRAPE : this.WINE;
      return await zapper.zapInToken(
        token.address,
        parseUnits(amount, 18),
        lpToken.address,
        SPOOKY_ROUTER_ADDR,
        this.myAccount,
      );
    }
  }
  async swapBBondToWine(gbondAmount: BigNumber): Promise<TransactionResponse> {
    const {WineSwapper} = this.contracts;
    return await WineSwapper.swapBBondToWine(gbondAmount);
  }
  async estimateAmountOfWine(gbondAmount: string): Promise<string> {
    const {WineSwapper} = this.contracts;
    try {
      const estimateBN = await WineSwapper.estimateAmountOfWine(parseUnits(gbondAmount, 18));
      return getDisplayBalance(estimateBN, 18, 6);
    } catch (err) {
      console.error(`Failed to fetch estimate wine amount: ${err}`);
    }
  }

  async getWineSwapperStat(address: string): Promise<WineSwapperStat> {
    const {WineSwapper} = this.contracts;
    const wineBalanceBN = await WineSwapper.getWineBalance();
    const gbondBalanceBN = await WineSwapper.getBBondBalance(address);
    // const grapePriceBN = await WineSwapper.getGrapePrice();
    // const winePriceBN = await WineSwapper.getWinePrice();
    const rateWinePerGrapeBN = await WineSwapper.getWineAmountPerGrape();
    const wineBalance = getDisplayBalance(wineBalanceBN, 18, 5);
    const gbondBalance = getDisplayBalance(gbondBalanceBN, 18, 5);
    return {
      wineBalance: wineBalance.toString(),
      gbondBalance: gbondBalance.toString(),
      // grapePrice: grapePriceBN.toString(),
      // winePrice: winePriceBN.toString(),
      rateWinePerGrape: rateWinePerGrapeBN.toString(),
    };
  }
}