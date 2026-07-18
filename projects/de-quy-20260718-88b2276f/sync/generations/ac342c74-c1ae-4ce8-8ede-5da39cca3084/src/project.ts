import {makeProject} from '@motion-canvas/core';
import narration from '../audio/narration.wav';

import scene01 from './scenes/01-de-quy-hop-long-nhau?scene';
import scene02 from './scenes/02-nestedboxescore?scene';
import scene03 from './scenes/03-recursiveconditions?scene';
import scene04 from './scenes/04-recursive-down-then-up?scene';
import scene05 from './scenes/05-recursiveboxcount?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04, scene05],
  audio: narration,
});
