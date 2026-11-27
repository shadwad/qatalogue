"""Where the build puts what the site serves, shared by build_default_summary.py, check_build.py and finalize_build.py."""
import os

# PUBLIC_DIR in the environment points a trial build (on copies) at another folder, as SERVE_DB_PATH does for the database.
PUBLIC_DIR = os.environ.get('PUBLIC_DIR') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public'))

# The summaries the site loads first. build_default_summary.py writes each as <name>.tmp beside serve.db.tmp;
# finalize_build.py moves them into place together with the database.
DEFAULT_INSTITUTIONS = "default-institutions.json.gz"
DEFAULT_RESEARCHERS = "default-researchers.json.gz"
DEFAULT_SUMMARIES = (DEFAULT_INSTITUTIONS, DEFAULT_RESEARCHERS)
