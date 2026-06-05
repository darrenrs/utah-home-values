import { useEffect } from "react";

function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

export default PageTitle;
