import { PHASES } from './engine-types';
import type { DCTopology, ElectricalOutput, OutputConnections, Phase } from './engine-types';

/** Teaching topology: the first connected conductor supplies equal return paths.
 * The ATV11 manual specifies SdC but does not specify this bridge arrangement. */
export function injectionTopology(connected: Readonly<OutputConnections>): DCTopology {
    const phases = PHASES.filter(phase => connected[phase]);
    return phases.length >= 2 ? { source: phases[0]!, returns: phases.slice(1) } : { source: null, returns: [] };
}

/** LCr is the RMS over three conductor magnitudes, including an open conductor.
 * This convention under imbalance is a teaching choice, not documented firmware. */
export function conductorMagnitudes(mode: ElectricalOutput['mode'], aggregateCurrent: number,
    connected: Readonly<OutputConnections>): Record<Phase, number> {
    const count = PHASES.filter(phase => connected[phase]).length;
    const common = count === 3 ? aggregateCurrent : count === 2 ? Math.sqrt(3 / 2) * aggregateCurrent : 0;
    const dcThree = mode === 'dc' && count === 3;
    return {
        U: connected.U ? dcThree ? Math.SQRT2 * aggregateCurrent : common : 0,
        V: connected.V ? dcThree ? Math.SQRT1_2 * aggregateCurrent : common : 0,
        W: connected.W ? dcThree ? Math.SQRT1_2 * aggregateCurrent : common : 0,
    };
}
