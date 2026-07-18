import {makeProject} from '@motion-canvas/core';

import scene01 from './scenes/01-de-quy-khong-lap-vo-tan?scene';
import scene02 from './scenes/02-nested-boxes-core?scene';
import scene03 from './scenes/03-de-quy-hai-dieu-kien?scene';
import scene04 from './scenes/04-recursivedescentandreturn?scene';
import scene05 from './scenes/05-recursiveboxcounting?scene';

export default makeProject({
  scenes: [scene01, scene02, scene03, scene04, scene05],
});
