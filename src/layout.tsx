import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  IconButton,
  Image,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import { motion } from "framer-motion";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

const MotionFlex = motion(Flex);

export function Content() {
  return (
    <Box
      height="100vh"
      overflowY="scroll"
      css={{
        scrollSnapType: "y mandatory",
        "&::-webkit-scrollbar": { display: "none" },
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-1"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <Stack
          align="center"
          justify="space-between"
          direction={["column", "row"]}
          px={[4, 12, 24]}
          py={[4, 8, 16]}
        >
          <Button variant="aibtcOrange">RSVP THURSDAYS</Button>
          <Button variant="aibtcOrange">MEETING MINUTES</Button>
        </Stack>
        <Flex flex={1} alignItems="center" justifyContent="center">
          <Image
            src={aibtcLogoWide}
            alt="AIBTCDEV Wide Logo"
            w="100%"
            maxW="1000px"
            p={4}
          />
        </Flex>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        bg="gray.100"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <Text fontSize="4xl" fontWeight="bold">
          Section 2
        </Text>
        <Text>Add your content for the second section here</Text>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        bg="gray.200"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <Text fontSize="4xl" fontWeight="bold">
          Section 3
        </Text>
        <Text>Add your content for the third section here</Text>
      </MotionFlex>
    </Box>
  );
}

export function Footer() {
  return (
    <Stack align="center" justify="space-between" direction="row" p={4}>
      <Text>&copy; 2024</Text>
      <ButtonGroup>
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Working Group Info"
          title="Working Group Info"
          icon={<FaInfo />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/orgs/stacks-network/discussions/531"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="GitHub Resources"
          title="GitHub Resources"
          icon={<FaGithub />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/aibtcdev"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Discord"
          title="Discord"
          icon={<FaDiscord />}
          size={["sm", null, "md"]}
          as="a"
          href="https://discord.gg/5DJaBrf"
          target="_blank"
          rel="noopener noreferrer"
        />
      </ButtonGroup>
    </Stack>
  );
}
