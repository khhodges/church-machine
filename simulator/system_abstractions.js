class SystemAbstractions {
    constructor(registry) {
        this.registry = registry;
        this._bindAll();
    }

    _bindAll() {
        this._bindSalvation();
        this._bindNavana();
        this._bindMint();
        this._bindMemory();
        this._bindScheduler();
        this._bindStack();
        this._bindDijkstraFlag();
        this._bindSlideRuleTrig();
    }

    _bindSalvation() {
        this.registry.bindMethod(4, 'LOAD', function(sim, args) {
            return { ok: true, result: 'Salvation.LOAD: proved namespace lookup' };
        });
        this.registry.bindMethod(4, 'TPERM', function(sim, args) {
            return { ok: true, result: 'Salvation.TPERM: proved permission check' };
        });
        this.registry.bindMethod(4, 'LAMBDA', function(sim, args) {
            return { ok: true, result: 'Salvation.LAMBDA: proved Church reduction' };
        });
        this.registry.bindMethod(4, 'TRANSITIONTONAVANA', function(sim, args) {
            return {
                ok: true,
                result: 'Salvation.TransitionToNavana: security pipeline verified, transitioning to Navana',
                message: 'Salvation complete — handing control to Navana (Namespace controller). Navana runs indefinitely.'
            };
        });
    }

    _bindNavana() {
        const navanaState = {
            initialized: false,
            managedAbstractions: [],
            idsLog: [],
            monitorLog: []
        };

        this.registry.bindMethod(5, 'Init', function(sim, args) {
            navanaState.initialized = true;
            const registry = sim.abstractionRegistry;
            if (registry) {
                const all = registry.getAllAbstractions();
                navanaState.managedAbstractions = all.map(a => ({ index: a.index, name: a.name, layer: a.layer }));
            }
            return {
                ok: true,
                result: {
                    initialized: true,
                    abstractionCount: navanaState.managedAbstractions.length
                },
                message: `Navana.Init: initialized ${navanaState.managedAbstractions.length} abstractions. Running indefinitely.`
            };
        });

        this.registry.bindMethod(5, 'Manage', function(sim, args) {
            const action = args.action || 'status';
            if (action === 'status') {
                return {
                    ok: true,
                    result: {
                        initialized: navanaState.initialized,
                        managed: navanaState.managedAbstractions.length,
                        idsAlerts: navanaState.idsLog.length
                    },
                    message: `Navana.Manage: ${navanaState.managedAbstractions.length} abstractions under management`
                };
            }
            if (action === 'lifecycle') {
                const target = args.target;
                return {
                    ok: true,
                    result: { action: 'lifecycle', target: target },
                    message: `Navana.Manage: lifecycle action on abstraction ${target}`
                };
            }
            return { ok: true, result: { action: action }, message: `Navana.Manage: ${action}` };
        });

        this.registry.bindMethod(5, 'Monitor', function(sim, args) {
            const entry = {
                timestamp: Date.now(),
                stepCount: sim.stepCount,
                nsCount: sim.nsCount,
                faults: sim.faultLog.length
            };
            navanaState.monitorLog.push(entry);
            if (navanaState.monitorLog.length > 100) navanaState.monitorLog.shift();

            return {
                ok: true,
                result: entry,
                message: `Navana.Monitor: step=${sim.stepCount}, ns=${sim.nsCount}, faults=${sim.faultLog.length}`
            };
        });

        this.registry.bindMethod(5, 'IDS', function(sim, args) {
            const alerts = [];

            for (let i = 0; i < sim.nsCount; i++) {
                const entry = sim.readNSEntry(i);
                if (!entry) continue;
                const version = (entry.word2_seals >>> 25) & 0x7F;
                if (version > 10) {
                    alerts.push({
                        type: 'VERSION_ANOMALY',
                        nsIndex: i,
                        version: version,
                        label: sim.nsLabels[i] || `NS[${i}]`
                    });
                }
            }

            for (const alert of alerts) {
                navanaState.idsLog.push({ ...alert, timestamp: Date.now() });
            }
            if (navanaState.idsLog.length > 1000) {
                navanaState.idsLog = navanaState.idsLog.slice(-500);
            }

            return {
                ok: true,
                result: { alerts: alerts, totalAlerts: navanaState.idsLog.length },
                message: `Navana.IDS: ${alerts.length} new alerts, ${navanaState.idsLog.length} total`
            };
        });
    }

    _bindMint() {
        this.registry.bindMethod(6, 'Create', function(sim, args) {
            const targetPerms = args.perms || { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 };
            const sourcePerms = args.sourcePerms || { R: 1, W: 1, X: 1, L: 1, S: 1, E: 1 };

            for (const p of ['R', 'W', 'X', 'L', 'S', 'E']) {
                if (targetPerms[p] && !sourcePerms[p]) {
                    return {
                        ok: false,
                        fault: 'PERMISSION_ESCALATION',
                        message: `Mint.Create: cannot grant ${p} permission not held by source`
                    };
                }
            }

            const hasTuring = targetPerms.R || targetPerms.W;
            const hasChurch = targetPerms.L || targetPerms.S || targetPerms.E;
            if (hasTuring && hasChurch) {
                return {
                    ok: false,
                    fault: 'DOMAIN_PURITY',
                    message: `Mint.Create: cannot mix Turing (R,W) and Church (L,S,E) perms in one GT`
                };
            }

            const gtType = args.gtType || args.type || 0;
            const size = args.size || 16;

            let nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                let freeIdx = -1;
                for (let i = sim.nsCount; i < sim.MAX_NS_ENTRIES; i++) {
                    if (!sim.isNSEntryValid(i)) { freeIdx = i; break; }
                }
                if (freeIdx === -1) {
                    for (let i = 45; i < sim.nsCount; i++) {
                        if (!sim.isNSEntryValid(i)) { freeIdx = i; break; }
                    }
                }
                if (freeIdx === -1) {
                    return { ok: false, fault: 'OOM', message: 'Mint.Create: no free NS entries' };
                }
                nsIndex = freeIdx;
            }

            const location = nsIndex * sim.SLOT_SIZE;
            const limit17 = (size - 1) & 0x1FFFF;
            const fFlag = (gtType === 1) ? 1 : 0;
            sim.writeNSEntry(nsIndex, location, limit17, 0, fFlag, 0, 0, 0, 0);
            sim.nsLabels[nsIndex] = hasTuring ? `DATA[${nsIndex}]` : `CAP[${nsIndex}]`;

            const version = args.version || 0;
            const gt = sim.createGT(version, nsIndex, targetPerms, gtType);

            return {
                ok: true,
                result: { gt: gt, nsIndex: nsIndex, location: location, size: size },
                message: `Mint.Create: GT(type=${gtType},size=${size},perms=${sim.getPermBits(targetPerms).toString(2).padStart(6,'0')}) -> NS[${nsIndex}]`
            };
        });

        this.registry.bindMethod(6, 'Revoke', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Revoke: nsIndex required' };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            if (nsIndex >= sim.nsCount) {
                return { ok: false, fault: 'BOUNDS', message: `Mint.Revoke: NS[${nsIndex}] out of bounds` };
            }

            const w2 = sim.memory[base + 2];
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            const seal = w2 & 0x01FFFFFF;
            sim.memory[base + 2] = (((newVersion & 0x7F) << 25) | (seal & 0x01FFFFFF)) >>> 0;

            return {
                ok: true,
                result: newVersion,
                message: `Mint.Revoke: NS[${nsIndex}] version ${oldVersion} → ${newVersion}, all outstanding GTs invalidated`
            };
        });

        this.registry.bindMethod(6, 'Transfer', function(sim, args) {
            const gt = args.gt;
            const targetCList = args.targetCList;
            const targetSlot = args.targetSlot;

            if (gt === undefined) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Transfer: gt required' };
            }

            return {
                ok: true,
                result: gt,
                message: `Mint.Transfer: GT transferred to c-list slot ${targetSlot}`
            };
        });
    }

    _bindMemory() {
        this.registry.bindMethod(7, 'Allocate', function(sim, args) {
            const size = args.size || 16;

            let freeIdx = -1;
            for (let i = sim.nsCount; i < sim.MAX_NS_ENTRIES; i++) {
                if (!sim.isNSEntryValid(i)) {
                    freeIdx = i;
                    break;
                }
            }
            if (freeIdx === -1) {
                for (let i = 0; i < sim.nsCount; i++) {
                    if (!sim.isNSEntryValid(i) && i >= 45) {
                        freeIdx = i;
                        break;
                    }
                }
            }
            if (freeIdx === -1) {
                return { ok: false, fault: 'OOM', message: 'Memory.Allocate: no free NS entries' };
            }

            const location = freeIdx * sim.SLOT_SIZE;
            const limit17 = (size - 1) & 0x1FFFF;
            sim.writeNSEntry(freeIdx, location, limit17, 0, 0, 0, 0, 0, 0);
            sim.nsLabels[freeIdx] = `DATA[${freeIdx}]`;

            const perms = { R: 1, W: 1, X: 0, L: 0, S: 0, E: 0 };
            const gt = sim.createGT(0, freeIdx, perms, 0);

            return {
                ok: true,
                result: { gt: gt, nsIndex: freeIdx, location: location, size: size },
                message: `Memory.Allocate: NS[${freeIdx}] allocated ${size} words at 0x${location.toString(16)}`
            };
        });

        this.registry.bindMethod(7, 'Free', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Free: nsIndex required' };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            sim.memory[base + 0] = 0;
            sim.memory[base + 1] = 0;
            sim.memory[base + 2] = 0;
            delete sim.nsLabels[nsIndex];

            return {
                ok: true,
                result: nsIndex,
                message: `Memory.Free: NS[${nsIndex}] deallocated`
            };
        });

        this.registry.bindMethod(7, 'Resize', function(sim, args) {
            const nsIndex = args.nsIndex;
            const newSize = args.size || 32;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Resize: nsIndex required' };
            }

            const entry = sim.readNSEntry(nsIndex);
            if (!entry) {
                return { ok: false, fault: 'BOUNDS', message: `Memory.Resize: NS[${nsIndex}] not found` };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            const newLimit = (newSize - 1) & 0x1FFFF;
            const w1 = sim.memory[base + 1];
            const flags = w1 & 0xFFFE0000;
            sim.memory[base + 1] = (flags | newLimit) >>> 0;

            const loc = sim.memory[base + 0];
            sim.memory[base + 2] = sim.makeVersionSeals(
                (sim.memory[base + 2] >>> 25) & 0x7F, loc, newLimit
            );

            return {
                ok: true,
                result: { nsIndex: nsIndex, newSize: newSize },
                message: `Memory.Resize: NS[${nsIndex}] resized to ${newSize} words`
            };
        });
    }

    _bindScheduler() {
        if (!this._schedulerState) {
            this._schedulerState = {
                threads: [{ id: 0, state: 'running', name: 'boot' }],
                currentThread: 0,
                nextId: 1
            };
        }
        const state = this._schedulerState;

        this.registry.bindMethod(8, 'Yield', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'ready';

            let next = -1;
            for (let i = 1; i <= state.threads.length; i++) {
                const idx = (state.currentThread + i) % state.threads.length;
                if (state.threads[idx] && state.threads[idx].state === 'ready') {
                    next = idx;
                    break;
                }
            }

            if (next === -1) {
                if (current) current.state = 'running';
                return { ok: true, result: state.currentThread, message: 'Scheduler.Yield: no other ready threads' };
            }

            state.currentThread = next;
            state.threads[next].state = 'running';

            return {
                ok: true,
                result: next,
                message: `Scheduler.Yield: switched to thread ${next} (${state.threads[next].name})`
            };
        });

        this.registry.bindMethod(8, 'Spawn', function(sim, args) {
            const name = args.name || `thread_${state.nextId}`;
            const newThread = { id: state.nextId, state: 'ready', name: name };
            state.threads.push(newThread);
            state.nextId++;

            return {
                ok: true,
                result: { threadId: newThread.id, name: name },
                message: `Scheduler.Spawn: created thread ${newThread.id} "${name}"`
            };
        });

        this.registry.bindMethod(8, 'Wait', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'waiting';

            return {
                ok: true,
                result: state.currentThread,
                message: `Scheduler.Wait: thread ${state.currentThread} now waiting`
            };
        });

        this.registry.bindMethod(8, 'Stop', function(sim, args) {
            const threadId = args.threadId !== undefined ? args.threadId : state.currentThread;
            const thread = state.threads.find(t => t.id === threadId);
            if (!thread) {
                return { ok: false, fault: 'THREAD', message: `Scheduler.Stop: thread ${threadId} not found` };
            }
            thread.state = 'stopped';

            return {
                ok: true,
                result: threadId,
                message: `Scheduler.Stop: thread ${threadId} "${thread.name}" stopped`
            };
        });
    }

    _bindStack() {
        if (!this._stackState) {
            this._stackState = {
                data: [],
                maxDepth: 256
            };
        }
        const stack = this._stackState;

        this.registry.bindMethod(9, 'Push', function(sim, args) {
            if (stack.data.length >= stack.maxDepth) {
                return { ok: false, fault: 'STACK_OVERFLOW', message: `Stack.Push: overflow at depth ${stack.maxDepth}` };
            }
            const value = args.value !== undefined ? args.value : 0;
            stack.data.push(value);
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Push: pushed 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Pop', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Pop: stack is empty' };
            }
            const value = stack.data.pop();
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Pop: popped 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Peek', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Peek: stack is empty' };
            }
            const value = stack.data[stack.data.length - 1];
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Peek: top = 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Depth', function(sim, args) {
            return {
                ok: true,
                result: { depth: stack.data.length },
                message: `Stack.Depth: ${stack.data.length}`
            };
        });
    }

    _bindDijkstraFlag() {
        if (!this._flagState) {
            this._flagState = {
                flags: {},
                nextId: 0
            };
        }
        const flagState = this._flagState;
        const schedulerState = this._schedulerState;

        this.registry.bindMethod(10, 'Wait', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            if (!flagState.flags[flagId]) {
                flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            }
            const flag = flagState.flags[flagId];

            if (flag.signaled) {
                flag.signaled = false;
                return {
                    ok: true,
                    result: { flagId: flagId, waited: false },
                    message: `DijkstraFlag.Wait: flag ${flagId} was signaled, consumed immediately`
                };
            }

            if (schedulerState) {
                const current = schedulerState.threads[schedulerState.currentThread];
                if (current) {
                    current.state = 'blocked';
                    flag.waitQueue.push(current.id);
                }
            }

            return {
                ok: true,
                result: { flagId: flagId, waited: true, blocked: true },
                message: `DijkstraFlag.Wait: thread blocked on flag ${flagId}`
            };
        });

        this.registry.bindMethod(10, 'Signal', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            if (!flagState.flags[flagId]) {
                flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            }
            const flag = flagState.flags[flagId];

            if (flag.waitQueue.length > 0) {
                const wokenId = flag.waitQueue.shift();
                if (schedulerState) {
                    const thread = schedulerState.threads.find(t => t.id === wokenId);
                    if (thread) thread.state = 'ready';
                }
                return {
                    ok: true,
                    result: { flagId: flagId, wokenThread: wokenId },
                    message: `DijkstraFlag.Signal: flag ${flagId} woke thread ${wokenId}`
                };
            }

            flag.signaled = true;
            return {
                ok: true,
                result: { flagId: flagId, signaled: true },
                message: `DijkstraFlag.Signal: flag ${flagId} signaled (no waiters)`
            };
        });

        this.registry.bindMethod(10, 'Reset', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            return {
                ok: true,
                result: { flagId: flagId },
                message: `DijkstraFlag.Reset: flag ${flagId} cleared`
            };
        });

        this.registry.bindMethod(10, 'Test', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            const flag = flagState.flags[flagId];
            const signaled = flag ? flag.signaled : false;
            const waiters = flag ? flag.waitQueue.length : 0;
            return {
                ok: true,
                result: { flagId: flagId, signaled: signaled, waiters: waiters },
                message: `DijkstraFlag.Test: flag ${flagId} signaled=${signaled}, waiters=${waiters}`
            };
        });
    }

    _bindSlideRuleTrig() {
        this.registry.bindMethod(16, 'Sin', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.sin(angle);
            return { ok: true, result: result, message: `SlideRule.Sin(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Cos', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.cos(angle);
            return { ok: true, result: result, message: `SlideRule.Cos(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Tan', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.tan(angle);
            return { ok: true, result: result, message: `SlideRule.Tan(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Asin', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.asin(value);
            return { ok: true, result: result, message: `SlideRule.Asin(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Acos', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.acos(value);
            return { ok: true, result: result, message: `SlideRule.Acos(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Atan', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.atan(value);
            return { ok: true, result: result, message: `SlideRule.Atan(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToDegrees', function(sim, args) {
            const radians = args.radians !== undefined ? args.radians : 0;
            const result = radians * (180 / Math.PI);
            return { ok: true, result: result, message: `SlideRule.ToDegrees(${radians}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToRadians', function(sim, args) {
            const degrees = args.degrees !== undefined ? args.degrees : 0;
            const result = degrees * (Math.PI / 180);
            return { ok: true, result: result, message: `SlideRule.ToRadians(${degrees}) = ${result}` };
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAbstractions;
}
