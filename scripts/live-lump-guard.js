'use strict';
const fs = require('fs');
const path = require('path');

function resolveExisting(target, seen = new Set()) {
    target = path.resolve(target);
    if (seen.has(target)) throw new Error('Cyclic output link is blocked.');
    seen.add(target);
    try {
        if (fs.lstatSync(target).isSymbolicLink())
            return resolveExisting(path.resolve(path.dirname(target), fs.readlinkSync(target)), seen);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (fs.existsSync(target)) return fs.realpathSync(target);
    const parent = path.dirname(target);
    return path.join(resolveExisting(parent, seen), path.basename(target));
}

function assertOfflineOutput(target) {
    const destination = resolveExisting(target);
    const live = resolveExisting(path.join(__dirname, '..', 'server', 'lumps'));
    if (destination === live || destination.startsWith(live + path.sep) ||
        live.startsWith(destination + path.sep)) {
        throw new Error('Direct writes to live server/lumps are blocked: build into a temporary output directory, review the result, then publish through the server confirmed admission path. No CLI approval bypass is available.');
    }
    if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(destination)) {
                const child = path.join(destination, name);
                const childStat = fs.lstatSync(child);
                if (childStat.isSymbolicLink()) {
                    const resolved = resolveExisting(child);
                    if (!resolved.startsWith(destination + path.sep) ||
                        (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()))
                        throw new Error('Escaping or directory output links are blocked; use an independent temporary copy.');
                }
                assertOfflineOutput(child);
            }
        } else if (stat.isFile() && stat.nlink > 1) {
            throw new Error('Linked output files are blocked; use an independent temporary copy.');
        }
    }
}
module.exports = { assertOfflineOutput };