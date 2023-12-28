import { TransactionsQueue, TxnResult, WAITING, DONE, FAILED, REVISION, MAX_RETRIES, RETRY, UNRESOLVED } from "./transaction-queues.js";
import { postTransaction } from "./transaction-queues.js";
import { SequencerLogger as log } from "./logs.js";

export { Sequencer };


class Sequencer {

  static _queues = new Map<string, TransactionsQueue>;

  // The set of Dispatchers used to submit transactions or actions
  // for a given type. There is one (and only one) Dispatcher per type.
   static _dispatchers = new Map<string, any>;
  
  /**
   * 
   * @returns 
   */
  static async run() {
    // get the running queues list
    let names = [...Sequencer._queues.keys()]; 

    for (let j=0; j < names.length; j++) {
      
      // 1. Check if we have a running transaction on course. If we have, we just pass.
      let queue = Sequencer._queues.get(names[j]) as TransactionsQueue;
      log.activeQueue(queue);      
      if (queue.hasRunningTx())
        continue; 

      // 2. If we have no running transactions
      // Check if we have pending transactions to run. If not, just pass.
      // If we have pending transactions, we retrieve the first one from the Queue (FIFO).
      let pendingTx = await queue.getFirstWaitingTransaction();
      if (! pendingTx)
        continue;

      // 3. Dispatch the pending transaction
      // first mark it as running so we dont use it until it has finished
      queue.setTxIsRunning(pendingTx.uid);
      
      // This is an asynchronous call, and will callback on Done or Failure.
      try {
        Sequencer.dispatch(queue, pendingTx);
      } 
      catch(err: any) {
        console.log("Sequencer dispatch failed ERR=", err);
      }
    }

    return Sequencer;
  }


  /**
   * Dispatch the transaction pending on this queue. It has to deal with the 
   * different states: WAITING, REVISION, DONE, FAILED, RETRY
   */
  static async dispatch(
    queue: TransactionsQueue,
    txData: any
  ) {
    if (! Sequencer._dispatchers.has(txData.type))
      return; // No dispatcher for this type, cant do anything

    // get the Dispatcher which will dispatch this Txn type
    let dispatcher = Sequencer._dispatchers.get(txData.type);
    log.dispatching(txData);

    try {
      // if a new transaction, need to dispatch it 
      if (txData.state === WAITING) {
        let result = await dispatcher.dispatch(txData); 

        // failed: there is some irrecoverable error and can do nothing 
        if (result.error) {
          await Sequencer.onTxnUnresolvedError(queue, txData, result);
          return;
        }
      
        // success: was submitted and goes to revision for inclusion
        log.dispatchedTxn(result);
        await Sequencer.onTxnRevision(queue, txData, result);
        return;        
      }

      // if not included yet, need to wait for it
      if (txData.state === REVISION) {
        let result = await dispatcher.waitForInclusion(txData.hash); 

        // failed
        let max = dispatcher.maxRetries();
        if (result.error) {
          // let's see if we can still retry
          let canRetry = await Sequencer.onTxnRetry(queue, txData, max, result);
          if (canRetry)
            return;

          // fully failed, no more retries
          await Sequencer.onTxnFailure(queue, txData, result);

          // and call the onFailure callback with this result
          result = await dispatcher.onFailure(txData, result);
        }

        // success ! and are done with it
        await Sequencer.onTxnDone(queue, txData, result);

        // we now can call the onSucess callback
        result = await dispatcher.onSuccess(txData, result);
      }
    }
    catch (result: any) {
      await Sequencer.onTxnUnresolvedError(queue, txData, result);
      return;
    }
  }


  // Send failed and we cant do anything to solve this
  // probably is a code error that raised an exception
  static async onTxnUnresolvedError(
    queue: TransactionsQueue, 
    pendingTxn: any, 
    result: TxnResult
  ) {
    let revisionTx = await queue.closeTransaction(pendingTxn.uid, {
      state: UNRESOLVED,
      result: result
    })
    queue.setNoRunningTx(); // free to run other one
    return;
  };

  // the Transaction was submitted to Mina but it has not been included
  // in a block yet. It is in REVISION state so we have to wait.
  static async onTxnRevision(
    queue: TransactionsQueue, 
    pendingTxn: any, 
    result: TxnResult
  ) {
    let revisionTx = await queue.closeTransaction(pendingTxn.uid, {
      state: REVISION,
      result: result
    })
    queue.setNoRunningTx(); // free to run other one
    return;
  };

  // the Action was succesfull so we update the transaction status
  static async onTxnDone(
    queue: TransactionsQueue, 
    pendingTxn: any, 
    result: TxnResult
  ) {
    let doneTx = await queue.closeTransaction(pendingTxn.uid, {
      state: DONE,
      result: result
    })
    queue.setNoRunningTx(); // free to run other one
    return;
  };

  // the Action has failed BUT anyway must update transaction status
  static async onTxnFailure(
    queue: TransactionsQueue, 
    pendingTxn: any, 
    result: TxnResult
  ) {
    log.error(result.error);
    result.error = result.error || {};
    let failedTx = await queue.closeTransaction(pendingTxn.uid, {
      state: FAILED,
      result: result
    })
    queue.setNoRunningTx(); // free to run other one
    return;
  }

  // the Action has failed BUT we may retry it
  static async onTxnRetry(
    queue: TransactionsQueue, 
    pendingTxn: any, 
    maxRetries: number,
    result: TxnResult
  ): Promise<boolean> {
    log.error(result.error);
    // we check if we have some retries left, and increment its count
    // so it can still be processed in the next cycle
    let retries = await queue.getTransactionRetries(pendingTxn.uid);
    if (retries < maxRetries) {
      let retryTx = await queue.retryTransaction(pendingTxn.uid, {
        MAX_RETRIES: maxRetries, 
        state: WAITING
      });
      queue.setNoRunningTx(); // free to run other one
      return true;
    } 
    return false;
  }


  /**
   * Cleanup queues, because there may be queues that have no more transactions
   * to process but are still in the Sequencer queues map. So we need to remove
   * this ones from the Map.
   * @returns: an array of the refreshed queues names
   */
  static async refreshQueues(): Promise<string[]> {
    let activeNames = (await TransactionsQueue.getActiveQueues())
                        .map((t: any) => { return t.queue });

    let runningNames = [...Sequencer._queues.keys()]; 
    (runningNames || []).forEach((name: string) => {
      // check if it is running 
      let queue = Sequencer._queues.get(name);
      if (queue?.hasRunningTx())
        return; // dont touch it !

      if (!queue?.hasRunningTx() && !activeNames.includes(name)) {
        Sequencer._queues.delete(name); // must remove it
        return;
      }
    });

    // now add all the new active ones not currently in the running set
    (activeNames || []).forEach((name: string) => {
      if (!runningNames.includes(name)) {
        Sequencer._queues.set(name, (new TransactionsQueue(name)));
        return;
      }
    })

    return [...Sequencer._queues.keys()];
  }


  /**
   * Adds a new dispatcher for a given transaction type. There is one, and 
   * only one dispatcher per type. Specific dispatchers are derived from the
   * AnyDispatcher class.
   * @param name A
   * @param dispatcher 
   */
  static addDispatcher(
    name: string, 
    dispatcher: any
  ) {
    Sequencer._dispatchers.set(name, dispatcher);
  }
 

  /**
   * Post a transaction to the Queue. Is a helper function to be used 
   * by internal and external code to post transactions without needing 
   * to create a Queue.
   */
  static async postTransaction(queueId: string, params: {
    type: string,
    data: object
  }): Promise<any> {
    let tx = await TransactionsQueue
      .queue(queueId)
      .push(params);
    log.postedTxn(tx);
  }
}
