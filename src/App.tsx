import { ChakraProvider, Flex } from "@chakra-ui/react";
import theme from "./theme";
import CustomFonts from "./fonts";
import { Header, Content, Footer } from "./layout";

function App() {
  return (
    <ChakraProvider theme={theme}>
      <CustomFonts />
      <Flex direction="column" minH="100vh" minW="250px">
        <Header />
        <Content />
        <Footer />
      </Flex>
    </ChakraProvider>
  );
}

export default App;
