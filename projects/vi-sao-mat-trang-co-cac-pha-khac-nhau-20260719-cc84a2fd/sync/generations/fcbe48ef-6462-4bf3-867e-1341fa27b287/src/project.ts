import {makeProject} from '@motion-canvas/core';
import narration from '../audio/narration.wav';

import scene01 from './scenes/01-moon-half-always-lit?scene';
import scene02 from './scenes/02-gocnhintaochuoipha?scene';

export default makeProject({
  scenes: [scene01, scene02],
  audio: narration,
});
