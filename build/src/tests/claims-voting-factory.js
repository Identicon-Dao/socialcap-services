import { PrivateKey, Mina, AccountUpdate, fetchAccount } from "o1js";
import { ClaimVotingContract } from "@socialcap/contracts";
import { checkTransaction } from "./test-helpers.js";
export { ClaimsVotingFactory };
let proofsEnabled = false;
let isCompiled = false;
const ClaimsVotingFactory = {
    compile: compileVotingContract,
    deploy: deployVotingContract,
    getInstance: getVotingInstance
};
const DEPLOY_TX_FEE = 300000000;
async function compileVotingContract(proofsEnabled) {
    // compile Contract
    proofsEnabled = proofsEnabled === undefined ? true : proofsEnabled;
    console.log("proofs enabled=", proofsEnabled);
    console.log("compiling Contract ...");
    if (proofsEnabled)
        await ClaimVotingContract.compile();
    console.log("compiled !");
    isCompiled = true;
}
async function deployVotingContract(claimUid, requiredVotes, requiredPositives, deployerAccount, deployerKey, isLocal) {
    // we ALWAYS compile it
    await ClaimVotingContract.compile();
    // we need to generate a new key pair for each deploy
    const zkAppKey = PrivateKey.random();
    const zkAppAddr = zkAppKey.toPublicKey();
    console.log(`\nzkApp instance address=${zkAppAddr.toBase58()}`);
    let zkApp = new ClaimVotingContract(zkAppAddr);
    console.log("zkApp instance created!");
    // deploy it 
    let txn = await Mina.transaction({ sender: deployerAccount, fee: DEPLOY_TX_FEE }, () => {
        // IMPORTANT: the deployer account must already be funded 
        // or this will fail miserably ughhh
        AccountUpdate.fundNewAccount(deployerAccount);
        zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update 
    // that requires signature authorization
    txn.sign([deployerKey, zkAppKey]);
    let pendingTx = await txn.send();
    console.log("zkApp instance deployed !");
    checkTransaction(pendingTx);
    // wait for account ...
    await fetchAccount({ publicKey: zkAppAddr });
    let counter = 0;
    if (isLocal === undefined || !isLocal) {
        await loopUntilAccountExists({
            account: zkAppAddr,
            eachTimeNotExist: () => {
                let ts = (new Date()).toISOString();
                counter = counter + 5; // every 5 secs
                console.log(`${ts} ${counter} ... waiting for zkApp account to be fully available ...`);
            },
            isZkAppAccount: true,
        });
    }
    // initialize it !
    // we can only call setup() AFTER we are sure the deployed account exists
    // otherwise we have failures when initializing ...
    console.log(`\nInitializing instance for claim='${claimUid.toString()}'`);
    console.log(`...requiredVotes='${requiredVotes}'`);
    console.log(`...requiredPositives='${requiredPositives}'`);
    txn = await Mina.transaction({ sender: deployerAccount, fee: DEPLOY_TX_FEE }, () => {
        zkApp.setup(claimUid, requiredVotes, requiredPositives);
    });
    await txn.prove();
    let pndTx2 = await txn.sign([deployerKey]).send();
    console.log("zkApp instance initialized !");
    checkTransaction(pndTx2);
    // get some value after deploy
    let actionsState = zkApp.actionsState.get();
    console.log("zkApp instance actionsState=", actionsState.toString());
    const instance = {
        instance: zkApp,
        address: zkAppAddr,
        secret: zkAppKey,
        txn: pndTx2.hash()
    };
    logIt(instance);
    return instance;
}
async function getVotingInstance(publicKey) {
    // we need to create an instance of an already deployed contract
    console.log(`\nzkApp instance address=${publicKey.toBase58()}`);
    let response = await fetchAccount({ publicKey: publicKey });
    console.log("zkApp account exists ?", response);
    console.log("zkApp status=", response.account?.zkapp?.appState);
    let zkApp = new ClaimVotingContract(publicKey);
    console.log("zkApp instance created!");
    // get some value after creating just for checking
    let actionsState = zkApp.actionsState.get();
    console.log("zkApp instance actionsState=", actionsState.toString());
    const instance = {
        instance: zkApp,
        address: publicKey
    };
    logIt(instance);
    return instance;
}
function logIt(zkapp) {
    console.log(`instance= ${JSON.stringify(zkapp.instance.account, null, 2)}`
        + `\naddress= ${zkapp.address.toBase58()}`
        + `\nsecret= ${zkapp?.secret?.toBase58() || ''}`);
}
async function loopUntilAccountExists({ account, eachTimeNotExist, isZkAppAccount, }) {
    for (;;) {
        let response = await fetchAccount({ publicKey: account });
        let accountExists = response.account !== undefined;
        //console.log(response.account);
        if (isZkAppAccount) {
            // CHANGED: accountExists = response.account?.appState !== undefined;
            accountExists = response.account?.zkapp?.appState !== undefined;
        }
        if (!accountExists) {
            eachTimeNotExist();
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        else {
            // TODO add optional check that verification key is correct once this is available in o1js
            return response.account;
        }
    }
}
//# sourceMappingURL=claims-voting-factory.js.map