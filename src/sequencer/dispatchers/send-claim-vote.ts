import { Mina, AccountUpdate, PrivateKey, PublicKey, Field } from "o1js";
import { ClaimVotingContract } from "@socialcap/claim-voting";
import { UID } from "@socialcap/contracts-lib";
import { Payers } from "./payers.js"
import { DEPLOY_TX_FEE } from "./standard-fees.js";
import { RawTxnData,
  SequencerLogger as log, 
  AnyDispatcher,
  TxnResult
} from "../core/index.js"

export { SendClaimVoteDispatcher };


class SendClaimVoteDispatcher extends AnyDispatcher {

  static uname = 'SEND_CLAIM_VOTES';

  name(): string { 
    return SendClaimVoteDispatcher.uname; 
  };

  maxRetries(): number {
    return 3;
  }

  /**
   * Creates a new zkApp using the ClaimVotingContract. Each claim has 
   * its own zkApp account created just for doing the voting on it.
   *
   * @param txnData: 
   *  account: { id, publickKey, privateKey } keys of the account to create
   *  claimUid: the Uid of the Claim binded to this account
   *  strategy: {requiredVotes,requiredPositives...} params for voting
   * @returns result of successfull transaction
   * @throws exception on failure, will be handled by Sequencer.dispatcher
   */
  async dispatch(txnData: RawTxnData) {
    // this data was send by postTransaction
    const { claimUid, vote } = txnData.data;
    
    const deployer = Payers.DEPLOYER;

    // we ALWAYS compile it
    await ClaimVotingContract.compile();

    // we need to generate a new key pair for each deploy
    const zkappPrivkey = PrivateKey.random();
    const zkappPubkey = zkappPrivkey.toPublicKey();

    let zkApp = new ClaimVotingContract(zkappPubkey);
    log.zkAppInstance(zkappPubkey.toBase58());
      
    let fuid = UID.toField(claimUid);
    let frv = Field(strategy.requiredVotes);
    let frp = Field(strategy.requiredPositives); 

    let result = await this.proveAndSend(
      // the transaction 
      () => {
        // IMPORTANT: the deployer account must already be funded 
        // or this will fail miserably ughhh
        AccountUpdate.fundNewAccount(deployer.publicKey);
        zkApp.deploy();
        zkApp.claimUid.set(fuid);
        zkApp.requiredVotes.set(frv);
        zkApp.requiredPositives.set(frp);
      }, 
      deployer.publicKey, DEPLOY_TX_FEE,   // feePayer and fee
      [deployer.privateKey, zkappPrivkey]  // sign keys
    );

    result.data = {
      claimUid: claimUid,
      strategy: strategy,
      accountId: zkappPubkey.toBase58(), 
      privateKey: zkappPrivkey.toBase58()
    }

    return result;
  }

  async onSuccess(
    txnData: RawTxnData, 
    result: TxnResult
  ): Promise<TxnResult> {
    const { claimUid, accountId } = txnData.data;
    return result;
  }

  async onFailure(
    txnData: RawTxnData, 
    result: TxnResult
  ): Promise<TxnResult> {
    const { claimUid, accountId } = txnData.data;
    return result;
  }
}
