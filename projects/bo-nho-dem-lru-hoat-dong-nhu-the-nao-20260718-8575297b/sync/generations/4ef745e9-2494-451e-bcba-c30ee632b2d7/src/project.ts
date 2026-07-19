import {makeProject} from '@motion-canvas/core';
import narration from '../audio/narration.wav';

import scene01 from './scenes/01-lru-intuition?scene';
import scene02 from './scenes/02-cache-hit-lam-moi-lru?scene';
import scene03 from './scenes/03-cache-miss-va-loai-bo-lru?scene';
import scene04 from './scenes/04-lru-complete-example?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04],
  audio: narration,
});
