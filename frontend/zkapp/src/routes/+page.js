import { error } from '@sveltejs/kit';

// this is only for testing/mockups
import { olClaimables } from '@models/mockup-objects';

/** @type {import('./$types').PageLoad} */
export async function load({ params, route, url }) {
    if (true) {
      return { 
        claimables: olClaimables
      }; 
    }
    throw error(404, 'Not found');
}
