import { TraversalTool } from './traversal.js';
import { RangeTool } from './range.js';
import { AiTool } from './ai.js';
import { StressTool } from './stress.js';
import { LibraryTool } from './library.js';

// Per-room helpers of the Gym scenes (readouts, debug overlays, keys, sliders). A level opts in with
// `"tool": "<key>"`. Game creates the tool after the level is loaded and disposes it before the level unloads;
// update(dt) runs every unpaused frame (late phase, after enemies and pickups). A tool may read and drive any
// system through `game` (it is test / debug code), but must free everything it adds in dispose().
// Interface: new Tool(game, level), update(dt), dispose().
export const TOOLS = { traversal: TraversalTool, range: RangeTool, ai: AiTool, stress: StressTool, library: LibraryTool };
