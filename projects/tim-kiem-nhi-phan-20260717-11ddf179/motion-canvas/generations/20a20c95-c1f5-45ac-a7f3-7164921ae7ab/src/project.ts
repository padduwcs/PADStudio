import {makeProject} from '@motion-canvas/core';

import scene01 from './scenes/01-binary-search-million-hook?scene';
import scene02 from './scenes/02-binary-guessing-game?scene';
import scene03 from './scenes/03-binary-search-conditions?scene';
import scene04 from './scenes/04-binary-search-log-complexity?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04],
});
