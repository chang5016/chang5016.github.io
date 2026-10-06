import * as THREE from 'three';
import { DownloadedMetroAssets, type MetroDisplay } from './metro-assets';
import { METRO_DOOR_WIDTH, METRO_HALF_WIDTH, METRO_LOCAL_DOORS } from './metro-system';
import { fitScooterRider } from './riding-pose';

export function createDownloadedMetroCar(assets: DownloadedMetroAssets, orientation: number, platformSide: number, channel: string) {
  const root = new THREE.Group(); root.name = 'Downloaded complete JFR1 / motorcycle interior';
  root.add(assets.create('jfr1-motorcycle-car'));
  const driver=assets.create('animal-driver');driver.rotation.y=Math.PI;root.add(driver);
  fitScooterRider(driver,{hip:new THREE.Vector3(0,1.60,15.25),hand:side=>new THREE.Vector3(-side*.25,1.94,15.78),foot:side=>new THREE.Vector3(-side*.22,.82,15.73),riderHeight:1.52,spineDirection:new THREE.Vector3(0,1,.12)});
  driver.name='Downloaded articulated bear / leading train cab operator';
  driver.userData.metroDriver=true;
  const doors: { root: THREE.Group; side: number; sign: number; base: number }[] = [], boards: MetroDisplay[] = [];
  const doorInstances = assets.instances('train-door', 12); root.add(doorInstances.root);
  const pocketInstances=assets.instances('platform-pocket',12);
  pocketInstances.root.name='Downloaded recessed train door pockets';
  pocketInstances.root.scale.y=4.08/3.35;root.add(pocketInstances.root);
  let pocketIndex=0;
  for (const side of [-1, 1]) for (const z of METRO_LOCAL_DOORS) {
    for(const sign of [-1,1]){
      // Actual downloaded opaque recesses conceal the complete glass leaf.
      // Their inner edges start at the aperture, never across the boarding lane.
      pocketInstances.set(pocketIndex++,side*(METRO_HALF_WIDTH-.06),0,z+sign*(METRO_DOOR_WIDTH/2+.86),side*Math.PI/2);
    }
    for (const sign of [-1, 1]) {
      const door = new THREE.Group(); door.rotation.y = side * Math.PI / 2; door.position.set(side * METRO_HALF_WIDTH, 0, z + sign * METRO_DOOR_WIDTH / 4);
      root.add(door); doors.push({ root: door, side, sign, base: door.position.z });
    }
    // Fit a complete downloaded interior panel as the door lintel. The native
    // display sits directly against it, rather than hanging into the cabin.
    const header = assets.create('boarding-threshold');
    header.name = 'Downloaded interior panel / integral door header';
    header.scale.set(.56 / 3.05, .05 / .025, 3.20 / .40);
    header.rotation.z = side * (Math.PI / 2 + .50);
    header.position.set(side * 3.06, 3.95, z);
    root.add(header);
    // Follow the downloaded curved roof shoulder. The upper edge now sits
    // directly below its 4.2 m soffit, with the case flush against the header.
    const board = assets.display('door-display', 3.0, .50, channel);
    board.root.scale.x = .16;
    board.root.rotation.z = side * .50;
    board.root.position.set(side * (3.06 - .024*Math.cos(.50)), 3.95-.024*Math.sin(.50), z);
    board.root.userData.wallMountedDisplay = { projection: .048, header: header.uuid };
    root.add(board.root); boards.push(board);
  }
  pocketInstances.commit();
  const activeSide = -platformSide * orientation;
  let lastDoor = NaN;
  const animate = (open: number) => {
    if (open === lastDoor) return; lastDoor = open;
    doors.forEach((part, index) => {
      const active=part.side===activeSide;
      part.root.position.x=part.side*(METRO_HALF_WIDTH-(active?Math.min(1,open/.12)*.11:0));
      part.root.position.z=part.base+(active?part.sign*(METRO_DOOR_WIDTH/2+.035)*Math.max(0,(open-.12)/.88):0);
      doorInstances.set(index, part.root.position.x, 0, part.root.position.z, part.root.rotation.y);
    });
    doorInstances.commit();
  };
  root.rotation.y = orientation * Math.PI / 2;
  root.userData.dynamicWorldObject = true;
  root.userData.downloadedAssembly = true;
  return { root, doors, boards, animate, driver, orientation };
}
