import React from "react";
import { Route, Routes } from "react-router-dom";

import Home from "./Home";
import RunView from "./RunView";

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/run/:id" element={<RunView />} />
    </Routes>
  );
};

export default App;
