import {makeProject} from '@motion-canvas/core';

import scene01 from './scenes/01-binary-search-hook-1m-to-20?scene';
import scene02 from './scenes/02-binary-search-middle-cut?scene';
import scene03 from './scenes/03-binary-search-when-to-use?scene';
import scene04 from './scenes/04-binary-search-log2-scene?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04],
});
