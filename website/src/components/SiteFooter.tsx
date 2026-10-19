const REPOSITORY_URL = "https://github.com/darrenrs/utah-home-values";

function SiteFooter() {
  return (
    <footer className="container site-footer">
      <p>
        <a href="https://darrenskidmore.com">© 2026 Darren R. Skidmore.</a> •{" "}
        <a href="https://darrenskidmore.com/privacy#utah-home-values">
          Privacy Policy
        </a>
        <br />
        Built as a public data tool. Not intended for real estate, legal, or
        financial services.
      </p>
      {__BUILD_COMMIT__ && (
        <a
          className="build-commit"
          href={`${REPOSITORY_URL}/commit/${__BUILD_COMMIT__}`}
          title="View this version's commit on GitHub"
        >
          {__BUILD_COMMIT__.slice(0, 7)}
        </a>
      )}
    </footer>
  );
}

export default SiteFooter;
