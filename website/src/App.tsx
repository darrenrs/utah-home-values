import { BrowserRouter, Route, Routes } from "react-router-dom";
import AboutPage from "./pages/AboutPage";
import HomePage from "./pages/HomePage";
import RankPage from "./pages/RankPage";

function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/rank" element={<RankPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
