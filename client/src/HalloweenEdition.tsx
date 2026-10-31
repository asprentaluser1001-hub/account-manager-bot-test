import { APP_EDITION, APP_VERSION } from './version';

export default function HalloweenEdition() {
  return <p className="halloween-edition"><span aria-hidden="true">🎃</span> v{APP_VERSION} <span>{APP_EDITION}</span></p>;
}
