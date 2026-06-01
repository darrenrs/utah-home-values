import { Link } from "react-router-dom";
import { withBaseUrl } from "../lib/baseUrl";

function SiteHeader() {
  return (
    <header>
      <nav className="container">
        <Link className="brand" aria-label="Go home" to="/">
          <span className="logo-mark" aria-hidden="true">
            <img src={withBaseUrl("image.png")} alt="" />
          </span>
          <strong>Utah Home Values</strong>
        </Link>
        <div>
          <Link to="/rank">Rankings</Link>
          <Link to="/about">About</Link>
          <a href="https://github.com/darrenrs/utah-home-values">GitHub</a>
        </div>
      </nav>
    </header>
  );
}

export default SiteHeader;
