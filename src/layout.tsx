import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Heading,
  IconButton,
  Image,
  Stack,
  StackProps,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import { motion } from "framer-motion";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

const MotionFlex = motion(Flex);

interface HeaderProps extends Omit<StackProps, "children"> {
  showLogo?: boolean;
}

function SectionHeader({
  showLogo = true,
  ...stackProps
}: HeaderProps): React.ReactElement {
  return (
    <Stack
      align="center"
      justify="space-between"
      direction={["column", "row"]}
      px={[4, 12, 24]}
      py={[4, 8, 16]}
      {...stackProps}
    >
      <Button
        variant="aibtcOrange"
        as="a"
        href="https://evt.to/emamdeggw"
        target="_blank"
        rel="noopener noreferrer"
      >
        RSVP THURSDAYS
      </Button>
      {showLogo && (
        <Image
          src={aibtcLogoWide}
          alt="AIBTCDEV Wide Logo"
          w="50%"
          maxW="1000px"
          p={4}
        />
      )}
      <Button
        variant="aibtcOrange"
        as="a"
        href="https://github.com/aibtcdev/communication/tree/main/meetings"
        target="_blank"
        rel="noopener noreferrer"
      >
        MEETING MINUTES
      </Button>
    </Stack>
  );
}

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
        <SectionHeader showLogo={false} />
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
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>
            Our community mission is to empower individuals by integrating
            Bitcoin with open-source AI, ensuring freedom, security, and
            innovation in a digital future.
          </Heading>
          <Text>
            We must ensure that this future belongs to everyone, not just a few.
            By combining Bitcoin with open-source AI, we empower individuals to
            stay free and in control, protecting our autonomy and
            revolutionizing how we live and work online.
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
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>3rd Panel</Heading>
          <Text>Could insert something here, represents 3rd background.</Text>
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
