/**
 * Implement some basic helper routes
 */
import * as fs from "fs";
import { fastify } from '../global.js';
import { hasError, UNKNOWN_ERROR } from '../errors.js';
import { prepareCommunityClaimsDownload } from "../controllers/communities-controller.js";
async function fileRoutes() {
    fastify.get('/api/download/community_claims', async (request, reply) => {
        const query = request.query;
        const uid = query.uid;
        let fileTmp = '/tmp';
        let fileName = `claims-${uid}-` + (new Date()).toISOString() + '.csv';
        let isReady = await prepareCommunityClaimsDownload(uid, `${fileTmp}/${fileName}`);
        if (!isReady) {
            reply
                .code(UNKNOWN_ERROR)
                .send(hasError.Unknown("Could not prepare download file."));
        }
        // Read the file data and send it
        const stream = fs.readFileSync(`${fileTmp}/${fileName}`, { encoding: "utf-8" });
        reply.header('Content-Disposition', 'attachment; filename=' + fileName);
        reply
            .send(stream.toString())
            .type('text/csv; charset=UTF-8')
            .code(200);
    });
}
export default fileRoutes;
//# sourceMappingURL=file-routes.js.map