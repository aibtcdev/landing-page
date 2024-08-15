import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Heading,
  IconButton,
  Image,
  ListItem,
  OrderedList,
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
        className="bg-pattern-2"
        alignItems="center"
        justifyContent="center"
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
          <Image
            src={aibtcLogoWide}
            alt="AIBTCDEV Wide Logo"
            w="50%"
            maxW="1000px"
            p={4}
          />
          <Button variant="aibtcOrange">MEETING MINUTES</Button>
        </Stack>
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>
            To empower individuals by integrating Bitcoin with open-source AI,
            ensuring freedom, security, and innovation in a decentralized
            digital future.
          </Heading>
          <Text>
            As AI transforms the digital world, we must ensure that this future
            belongs to everyone, not just a few. By combining Bitcoin with
            open-source AI, we empower individuals to stay free and in control,
            protecting our autonomy and revolutionizing how we live and work
            online.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-3"
        alignItems="center"
        justifyContent="center"
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
          <Image
            src={aibtcLogoWide}
            alt="AIBTCDEV Wide Logo"
            w="50%"
            maxW="1000px"
            p={4}
          />
          <Button variant="aibtcOrange">MEETING MINUTES</Button>
        </Stack>
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>Values</Heading>
          <OrderedList spacing={3}>
            <ListItem>
              <Text as="span" fontWeight="bold">
                Freedom:
              </Text>{" "}
              Ensuring everyone has control over their digital lives and choices
              in an AI-driven world.
            </ListItem>
            <ListItem>
              <Text as="span" fontWeight="bold">
                Composability:
              </Text>{" "}
              Building a flexible, open marketplace where ideas and tools can
              connect and grow.
            </ListItem>
            <ListItem>
              <Text as="span" fontWeight="bold">
                Innovation:
              </Text>{" "}
              Moving fast, experimenting boldly, and refining as we go to drive
              progress.
            </ListItem>
            <ListItem>
              <Text as="span" fontWeight="bold">
                Empowerment:
              </Text>{" "}
              Making AI tools accessible to all, so everyone can thrive in the
              new digital economy.
            </ListItem>
            <ListItem>
              <Text as="span" fontWeight="bold">
                Security:
              </Text>{" "}
              Safeguarding autonomy with decentralized, secure technologies like
              Bitcoin.
            </ListItem>
          </OrderedList>
        </Stack>
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
