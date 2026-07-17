import {makeProject} from '@motion-canvas/core';

import scene01 from './scenes/01-binary-search-hook-scene?scene';
import scene02 from './scenes/02-binary-search-guessing-model?scene';
import scene03 from './scenes/03-binary-search-when-to-use-scene?scene';
import scene04 from './scenes/04-binary-search-logarithm-beats?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04],
});
