import { ChakraProvider, Flex } from "@chakra-ui/react";
import theme from "./theme";
import CustomFonts from "./fonts";
import { Content, Footer } from "./layout";

function App() {
  return (
    <ChakraProvider theme={theme}>
      <CustomFonts />
      <Flex direction="column" minH="100vh" minW="250px">
        <Content />
        <Footer />
      </Flex>
    </ChakraProvider>
  );
}

export default App;
