/**
 * OffchainMerkleMap
 * Describes a Merkle Map which will be stored in this server using a 
 * RDBMS and can be accesed using the API.
 * @created - MAZito - 2023-06-06
 */
import { Field, MerkleMap, MerkleMapWitness } from "snarkyjs"
import { logger, prisma } from "../core/global.js";
import { hashString, uuidToField } from "./helpers.js";
import { ResultOrError, hasError, hasResult } from "../core/responses.js";

export { OffchainMerkleMap, MerkleMapUpdate, LeafInstance };


/**
 * LeafInstance
 * Describes a MerkleMap leaf, which contains both the 'data' stored in the
 * leaf and the 'hash' of this data. The 'hash' value is calculated by
 * the 'set(key,data)' method when we update the MerkleMap.
 */
type LeafInstance = {
  key: Field, // the key of this Leaf (may be redundant but useful)
  hash: Field, // the hashed(data) value as 
  data: any // the leaf real data content, as a JSON object 
}


/**
 * MerkleMapUpdate
 * Describes the last "provable?" change applied to a given OffchainMerkleMap 
 * after using the .set(key,data) method on it. It can be used to update the
 * state of commitment (a Merkle root) in a MINA account.
 * Contains both the previous map state and the current updated state.
*/
type MerkleMapUpdate = {
  // transaction id of the transaction which produced the change
  txId: Field, 

  // the map index (may be redundant but useful)
  mapId: number, 

  // root and leaf value BEFORE we applied the update
  beforeRoot: Field, 
  beforeLeaf: LeafInstance,
  
  // root and leaf value AFTERr we applied this update
  afterRoot: Field, 
  afterLeaf: LeafInstance 
}


/**
 * OffchainMerkleMap
 * Describes a Merkle Map which will be stored in this server using a 
 * RDBMS and can be accesed using the API.
 */
class OffchainMerkleMap {
  id: number;
  name: string; 
  memmap: MerkleMap; // memoized instance of the MerkleMap
  root: Field;
  count: number; // leafs count

  constructor(id: number, name?: string) {
    this.id = id;
    this.name = name || "mm"+id.toString();
    this.memmap = new MerkleMap();
    this.root = this.memmap.getRoot();
    this.count = 0;
  }

  /**
   * Get a given key+value pair from the map
   * @param uid: string: the leaf key to get
   * @returns - 
   */
  async get(
    uid: string
  ): Promise<ResultOrError> {
    if (!uid) return hasError.BadRequest(`Missing param 'uid'`);

    const storedLeaf = await prisma.merkleMapLeaf.findUnique({
      where: { uid: uid }
    })    
    if (! storedLeaf) 
      return hasError.NotFound(`Not Found leaf with uid=${uid}`);

    let instance: LeafInstance = {
      key: Field(storedLeaf.key), 
      hash: Field(storedLeaf.hash),
      data: JSON.parse(storedLeaf.data) 
    };

    return hasResult(instance)
  }

  /** 
   * Sets (inserts or updates) a given 'uid' key with its data
   * @param uid: string - the leaf key to update or insert 
   * @param data: any - the leaf data pack to insert/upload
   * @param hash?: Field - optional hash of the leaf data, we will use this one if received
   * @returns MerkleMapUpdate in result or error 
   */
  async set(
    uid: string, 
    data: any,
    hash?: Field
  ): Promise<ResultOrError> {
    if (!uid) 
      return hasError.BadRequest(`Missing param 'uid'`);

    const currentRoot = this.memmap.getRoot();
    
    // check if the key already exists, or Null
    const storedLeaf = await prisma.merkleMapLeaf.findUnique({
      where: { uid: uid }
    })
    
    // serialize the received data and create Hash for it
    const key = uuidToField(uid);
    let stringified = "";
    try { stringified = JSON.stringify(data); }
    catch { stringified = "{}"; }
    const hashed = hash || hashString(stringified);
    const index = storedLeaf ? storedLeaf.index : this.count;
    const isNewLeaf = !storedLeaf;

    // update the current Merkle Map
    try {
      this.memmap.set(key, hashed);
      this.count = storedLeaf ? this.count : this.count +1;
    } 
    catch (err: any) {
      return hasError.InternalServer(
        `Could not set MerkleMapLeaf with uid='${uid}' err=`+err.toString()
      )
    }

    // update or insert the leaf
    const updatedLeaf = await prisma.merkleMapLeaf.upsert({
      where: { uid: uid },
      update: { 
        hash: hashed.toString(), 
        data: stringified 
      },
      create: { 
        uid: uid, mapId: this.id, index: index, 
        key: key.toString(), 
        hash: hashed.toString(), 
        data: stringified 
      },
    })

    // check if leaf upsert operation succeeded, on failure we must revert 
    // the Map operation because the key,hash was already updated in the Map 
    if (! updatedLeaf) {
      this.memmap.set(key, Field(0)); // rollback the key
      return hasError.DatabaseEngine(
        `Could not set MerkleMapLeaf with uid='${uid}'`
      )
    }

    // prepare the Update instance we will return
    const merkleUpdate: MerkleMapUpdate = {
      mapId: this.id,
      txId: Field(0),
      beforeRoot: currentRoot,
      beforeLeaf: { 
        key:  Field(storedLeaf?.key || "0"),
        hash:  Field(storedLeaf?.hash || "0"),
        data: JSON.parse(storedLeaf?.data || "{}")
      },
      afterRoot: this.memmap.getRoot(),
      afterLeaf: {
        key: key,
        hash: hashed,
        data: JSON.parse(stringified)
      }
    }

    return hasResult(merkleUpdate);
  }

  /**
   * Get the root of the memoized Merkle map
   * @returns - the MerkleMap root 
   */
  getRoot(): Field {
    return this.memmap.getRoot() || null;
  }

  /** 
   * Get a Witness of the memoized Merkle map, using its uid
   * @param uid: string - the uid of the leaf to witness
   * @returns - the MerkleMapWitness or null 
   */
  getWitness(uid: string): MerkleMapWitness | null {
    const key = uuidToField(uid);
    return this.memmap.getWitness(key) || null;
  }

  /** Get the the amount of leaf nodes. */
  size(): number {
    return this.count;
  }
}