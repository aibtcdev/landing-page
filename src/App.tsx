import { ChakraProvider } from "@chakra-ui/react";
import theme from "./theme";
import CustomFonts from "./fonts";
import { Content } from "./layout";

function App() {
  return (
    <ChakraProvider theme={theme}>
      <CustomFonts />

      <Content />
    </ChakraProvider>
  );
}

export default App;
