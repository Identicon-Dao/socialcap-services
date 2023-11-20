import { Mina } from "o1js";
import { merkleStorage } from "../global.js";
import { IDispatcherEntry, addDispatcher } from "./all-dispatchers.js";
import { SequencerLogger as log } from "./logs.js";
import { Sequencer } from "./sequencer.js";

const INTERVAL = 10000; // every 10 secs


export function setupSequencer(params: {
  dispatchers: IDispatcherEntry[]
}) {
  (params.dispatchers || []).forEach((t) => {
    addDispatcher(t.name, t.dispatcher);
  })

  console.log("\nRun on Mina.Berkeley");
  const 
    BERKELEY_URL = 'https://proxy.berkeley.minaexplorer.com/graphql',
    ARCHIVE_URL = 'https://archive.berkeley.minaexplorer.com/';

  const Berkeley = Mina.Network({
    mina: BERKELEY_URL, 
    archive: ARCHIVE_URL
  });
  Mina.setActiveInstance(Berkeley);



  
}


export async function runSequencer() {
  // run it ...
  let activeQueuesNames = await Sequencer.refreshQueues();
  await Sequencer.run();
  log.running(activeQueuesNames);

  // reschedule for next INTERVAL
  let timer = setTimeout(async () => {
    clearTimeout(timer);
    runSequencer();
  }, INTERVAL) 
}

export function startSequencer() {

  // start the Db storage
  merkleStorage.startup();
  
  // we need the Db to be ready before we can do anything
  // so we make it wait for INTERVAL secs before running
  setTimeout(async () => {
    runSequencer()
  }, INTERVAL);
}
